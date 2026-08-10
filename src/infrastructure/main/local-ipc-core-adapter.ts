import { createConnection, type Socket } from "node:net";
import { defaultDeviceLayout, type DeviceLayout } from "../../shared/device-layout";
import { err, ok, type Result } from "../../shared/result";
import {
  cloneSnapshot,
  createEmptyProfile,
  validatePageConfig,
  type PageConfig,
  type Profile,
  type StudioSnapshot
} from "../../domain/profile";
import type { Action } from "../../domain/action";
import type { ActionExecutionStatus, ActionExecutionTarget } from "../../application/ports/action-executor-port";
import type { ConnectionStatus, CoreEvent, CorePort, Unsubscribe, VirtualInput } from "../../application/ports/core-port";
import {
  assignmentDtoFromAction,
  controlDtoFromVirtualInput,
  createClientEnvelope,
  createHandshakeMessage,
  keyroProtocolVersion,
  type ActionFailureCode,
  type ActionEventDto,
  type ClientEnvelope,
  type ClientMessage,
  type ControlDto,
  type ErrorCode,
  type ErrorMessage,
  type ProfilesMessage,
  type ProtocolVersion,
  type ServerMessage
} from "./core-protocol";

export type LocalIpcCoreAdapterOptions = {
  socketPath?: string;
  componentVersion?: string;
  layout?: DeviceLayout;
  connect?: (socketPath: string) => LocalIpcSocket;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type LocalIpcSocket = {
  destroyed: boolean;
  destroy(): unknown;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  once(event: "connect", listener: () => void): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  write(data: string, callback?: (error?: Error) => void): boolean;
};

export class LocalIpcCoreAdapter implements CorePort {
  private socket: LocalIpcSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private status: ConnectionStatus = { state: "disconnected", reason: "Not connected." };
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly executionTargets = new Map<string, ActionExecutionTarget>();
  private readonly pageCache = new Map<string, PageConfig[]>();
  private readonly layout: DeviceLayout;
  private buffer = "";
  private requestSequence = 0;

  constructor(private readonly options: LocalIpcCoreAdapterOptions = {}) {
    this.layout = options.layout ?? defaultDeviceLayout;
  }

  subscribe(listener: (event: CoreEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    listener({ type: "connection", status: this.status });
    return () => this.listeners.delete(listener);
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.status;
  }

  async getSnapshot(): Promise<Result<StudioSnapshot>> {
    const response = await this.sendRequest({ type: "list_profiles" });
    if (!response.ok) return response;
    if (response.value.type !== "profiles") return err("core_unavailable", "Core returned an unexpected response.");

    const snapshot = this.snapshotFromProfiles(response.value);
    this.emit({ type: "snapshot", snapshot });
    return ok(cloneSnapshot(snapshot));
  }

  async getDeviceLayout(): Promise<Result<DeviceLayout>> {
    return ok(this.layout);
  }

  async createProfile(_name: string): Promise<Result<Profile>> {
    return err("unsupported_operation", "Core profile creation is not available over IPC yet.");
  }

  async renameProfile(_profileId: string, _name: string): Promise<Result<Profile>> {
    return err("unsupported_operation", "Core profile rename is not available over IPC yet.");
  }

  async activateProfile(profileId: string): Promise<Result<StudioSnapshot>> {
    const activated = await this.sendRequest({ type: "set_active_profile", profile_id: profileId });
    if (!activated.ok) return activated;
    if (activated.value.type !== "acknowledged") return err("core_unavailable", "Core returned an unexpected response.");
    return this.getSnapshot();
  }

  async savePage(profileId: string, page: PageConfig): Promise<Result<StudioSnapshot>> {
    const validated = validatePageConfig(page, this.layout);
    if (!validated.ok) return validated;

    const previousPage =
      this.pageCache.get(profileId)?.[page.index] ??
      createEmptyProfile(profileId, "Cached", this.layout).pages[page.index]!;
    const changes = changedActionsFromPage(profileId, previousPage, page);
    if (changes.some((change) => change.action === null)) {
      return err("unsupported_operation", "Core assignment clearing is not available over IPC yet.");
    }
    if (changes.length > 1) {
      return err("unsupported_operation", "Core IPC can save only one assignment change at a time.");
    }

    for (const { target, action } of changes) {
      if (!action) continue;
      const saved = await this.sendRequest({
        type: "save_assignment",
        assignment: assignmentDtoFromAction(profileId, target, action)
      });
      if (!saved.ok) return saved;
      if (saved.value.type !== "acknowledged") return err("core_unavailable", "Core returned an unexpected response.");
    }

    const pages = this.pageCache.get(profileId) ?? createEmptyProfile(profileId, "Cached", this.layout).pages;
    pages[page.index] = structuredClone(page);
    this.pageCache.set(profileId, pages);
    return this.getSnapshot();
  }

  async sendVirtualInput(input: VirtualInput): Promise<Result<ActionExecutionStatus>> {
    const target = actionTargetFromVirtualInput(input);
    const response = await this.sendRequest({
      type: "virtual_control_input",
      control: controlDtoFromVirtualInput(input)
    });
    if (!response.ok) {
      return ok({
        state: "failure",
        target,
        code: "internal",
        message: response.error.message
      });
    }
    if (response.value.type !== "acknowledged") return err("core_unavailable", "Core returned an unexpected response.");
    return ok({ state: "success", target, message: "Action request completed." });
  }

  async simulateDisconnect(): Promise<ConnectionStatus> {
    this.closeSocket("Disconnect requested.");
    return this.status;
  }

  async simulateReconnect(): Promise<ConnectionStatus> {
    this.closeSocket("Reconnect requested.");
    this.setStatus({ state: "reconnecting", reason: "Reconnect requested." });
    await this.ensureConnected();
    return this.status;
  }

  async close(): Promise<void> {
    this.closeSocket("Closed.");
    this.listeners.clear();
  }

  private async sendRequest(message: ClientMessage): Promise<Result<ServerMessage>> {
    try {
      await this.ensureConnected();
      const response = await this.writeEnvelope(message);
      if (response.type === "error") return errorFromServer(response);
      return ok(response);
    } catch (error) {
      return err("core_unavailable", "Could not communicate with Keyro Core.", errorMessage(error));
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connectPromise) return this.connectPromise;

    this.setStatus({ state: "connecting" });
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = this.createSocket();
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => this.handleData(String(chunk)));
      socket.on("error", (error) => {
        this.rejectPending(error);
        this.setStatus({ state: "error", message: error.message });
        fail(error);
      });
      socket.on("close", () => {
        this.socket = null;
        this.connectPromise = null;
        this.rejectPending(new Error("Core IPC connection closed."));
        this.setStatus({ state: "disconnected", reason: "Core IPC connection closed." });
      });
      socket.once("connect", () => {
        this.writeEnvelope(createHandshakeMessage(this.options.componentVersion ?? "0.1.0"))
          .then((message) => {
            if (message.type !== "handshake_accepted") {
              throw new Error("Core rejected the protocol handshake.");
            }
            if (!isCompatibleProtocol(message.protocol)) {
              throw new Error("Core returned an incompatible protocol version.");
            }
            this.setStatus({ state: "connected" });
            settled = true;
            resolve();
          })
          .catch((error) => {
            this.closeSocket(errorMessage(error));
            fail(error instanceof Error ? error : new Error(errorMessage(error)));
          });
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private writeEnvelope(message: ClientMessage): Promise<ServerMessage> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error("Core IPC socket is not connected."));

    const requestId = this.nextRequestId();
    const envelope: ClientEnvelope = createClientEnvelope(requestId, message);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error("Core IPC request timed out.");
        this.setStatus({ state: "error", message: error.message });
        reject(error);
      }, this.options.requestTimeoutMs ?? 5000);
      this.pending.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout
      });
      socket.write(`${JSON.stringify(envelope)}\n`, (error) => {
        if (error) {
          const pending = this.pending.get(requestId);
          this.pending.delete(requestId);
          if (pending) clearTimeout(pending.timeout);
          reject(error);
        }
      });
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      this.handleServerLine(line);
    }
  }

  private handleServerLine(line: string): void {
    const message = decodeServerMessage(line);
    if (!message) {
      this.closeSocket("Core IPC returned a malformed message.");
      return;
    }

    if (message.type === "action_event") {
      this.handleActionEvent(message.event);
      return;
    }

    const requestId = "request_id" in message ? message.request_id : null;
    if (typeof requestId !== "string") return;
    const pending = this.pending.get(requestId);
	    if (!pending) return;
	    this.pending.delete(requestId);
	    pending.resolve(message);
  }

  private handleActionEvent(event: ActionEventDto): void {
    if (event.state === "running") {
      const target = actionTargetFromControl(event.profile_id, event.control);
      this.executionTargets.set(event.execution_id, target);
      this.emit({ type: "action", status: { state: "running", target } });
      return;
    }

    const target = this.executionTargets.get(event.execution_id);
    if (!target) return;
    this.executionTargets.delete(event.execution_id);
    if (event.state === "succeeded") {
      this.emit({ type: "action", status: { state: "success", target, message: "Action completed." } });
      return;
    }
    this.emit({ type: "action", status: { state: "failure", target, code: event.code, message: event.message } });
  }

  private snapshotFromProfiles(message: ProfilesMessage): StudioSnapshot {
    const profiles = message.profiles.map((profile) => {
      const pages =
        this.pageCache.get(profile.id) ??
        createEmptyProfile(profile.id, profile.name, this.layout, profile.is_active).pages;
      this.pageCache.set(profile.id, pages);
      return {
        id: profile.id,
        name: profile.name,
        active: profile.is_active,
        pages: structuredClone(pages)
      };
    });
    return {
      layout: this.layout,
      profiles,
      activeProfileId: profiles.find((profile) => profile.active)?.id ?? null
    };
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `studio-${this.requestSequence}`;
  }

  private socketPath(): string {
    return this.options.socketPath ?? `${process.env.HOME ?? ""}/Library/Application Support/Keyro/Core/keyro-core-dev.sock`;
  }

  private createSocket(): LocalIpcSocket {
    return this.options.connect?.(this.socketPath()) ?? createConnection({ path: this.socketPath() });
  }

  private closeSocket(reason: string): void {
    this.socket?.destroy();
    this.socket = null;
    this.connectPromise = null;
    this.rejectPending(new Error(reason));
    this.setStatus({ state: "disconnected", reason });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit({ type: "connection", status });
  }

  private emit(event: CoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

type ActionChange = {
  target: ActionExecutionTarget;
  action: Action | null;
};

function changedActionsFromPage(
  profileId: string,
  previousPage: PageConfig,
  page: PageConfig
): ActionChange[] {
  const actions: ActionChange[] = [];
  for (const key of page.keys) {
    if (!actionsEqual(previousPage.keys[key.index]?.action ?? null, key.action)) {
      actions.push({
        target: { type: "key", profileId, pageIndex: page.index, keyIndex: key.index },
        action: key.action
      });
    }
  }
  for (const encoder of page.encoders) {
    for (const [interaction, action] of [
      ["rotateLeft", encoder.rotateLeft],
      ["rotateRight", encoder.rotateRight],
      ["press", encoder.press]
    ] as const) {
      if (!actionsEqual(previousPage.encoders[encoder.index]?.[interaction] ?? null, action)) {
        actions.push({
          target: { type: "encoder", profileId, pageIndex: page.index, encoderIndex: encoder.index, interaction },
          action
        });
      }
    }
  }
  return actions;
}

function actionsEqual(left: Action | null, right: Action | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function actionTargetFromVirtualInput(input: VirtualInput): ActionExecutionTarget {
  if (input.type === "key") {
    return {
      type: "key",
      profileId: input.profileId,
      pageIndex: input.pageIndex,
      keyIndex: input.keyIndex
    };
  }
  return {
    type: "encoder",
    profileId: input.profileId,
    pageIndex: input.pageIndex,
    encoderIndex: input.encoderIndex,
    interaction: input.interaction
  };
}

function actionTargetFromControl(profileId: string, control: ControlDto): ActionExecutionTarget {
  if (control.kind === "key") {
    return {
      type: "key",
      profileId,
      pageIndex: control.page,
      keyIndex: control.key
    };
  }
  return {
    type: "encoder",
    profileId,
    pageIndex: control.page,
    encoderIndex: control.encoder,
    interaction: encoderInteractionFromOperation(control.operation)
  };
}

function encoderInteractionFromOperation(operation: "left" | "right" | "press") {
  if (operation === "left") return "rotateLeft";
  if (operation === "right") return "rotateRight";
  return "press";
}

function errorFromServer(message: ErrorMessage): Result<never> {
  const code = message.error.code === "validation_failed" ? "validation_error" : "core_unavailable";
  return err(code, message.error.message);
}

function decodeServerMessage(line: string): ServerMessage | null {
  let input: unknown;
  try {
    input = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(input) || typeof input.type !== "string") return null;

  switch (input.type) {
    case "handshake_accepted":
      if (
        typeof input.request_id === "string" &&
        typeof input.core_version === "string" &&
        isProtocolVersion(input.protocol)
      ) {
        return input as unknown as ServerMessage;
      }
      return null;

    case "profiles":
      if (typeof input.request_id === "string" && Array.isArray(input.profiles) && input.profiles.every(isProfileDto)) {
        return input as unknown as ServerMessage;
      }
      return null;

    case "acknowledged":
      return typeof input.request_id === "string" ? (input as unknown as ServerMessage) : null;

    case "action_event":
      return isActionEventDto(input.event) ? (input as unknown as ServerMessage) : null;

    case "error":
      if ((typeof input.request_id === "string" || input.request_id === null) && isErrorDto(input.error)) {
        return input as unknown as ServerMessage;
      }
      return null;

    default:
      return null;
  }
}

function isCompatibleProtocol(protocol: ProtocolVersion): boolean {
  return protocol.major === keyroProtocolVersion.major && protocol.minor === keyroProtocolVersion.minor;
}

function isProtocolVersion(input: unknown): input is ProtocolVersion {
  return isRecord(input) && Number.isInteger(input.major) && Number.isInteger(input.minor);
}

function isProfileDto(input: unknown): boolean {
  return (
    isRecord(input) &&
    typeof input.id === "string" &&
    typeof input.name === "string" &&
    typeof input.is_active === "boolean"
  );
}

function isActionEventDto(input: unknown): input is ActionEventDto {
  if (!isRecord(input) || typeof input.execution_id !== "string") return false;
  if (input.state === "running") {
    return typeof input.profile_id === "string" && isControlDto(input.control);
  }
  if (input.state === "succeeded") return true;
  return input.state === "failed" && isActionFailureCode(input.code) && typeof input.message === "string";
}

function isControlDto(input: unknown): input is ControlDto {
  if (!isRecord(input) || !Number.isInteger(input.page)) return false;
  if (input.kind === "key") return Number.isInteger(input.key);
  return input.kind === "encoder" && Number.isInteger(input.encoder) && isEncoderOperation(input.operation);
}

function isEncoderOperation(input: unknown): input is "left" | "right" | "press" {
  return input === "left" || input === "right" || input === "press";
}

function isActionFailureCode(input: unknown): input is ActionFailureCode {
  return input === "open_url_failed" || input === "no_action_assigned" || input === "validation_failed" || input === "internal";
}

function isErrorDto(input: unknown): boolean {
  return isRecord(input) && isErrorCode(input.code) && typeof input.message === "string";
}

function isErrorCode(input: unknown): input is ErrorCode {
  return (
    input === "incompatible_protocol" ||
    input === "unknown_message" ||
    input === "validation_failed" ||
    input === "internal"
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
