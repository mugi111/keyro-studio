import type { StudioService } from "../../application/studio-service";
import type { PageConfig } from "../../domain/profile";
import type { Result } from "../../shared/result";
import { createOpenUrlAction } from "../../domain/action";
import {
  actionEventDtoFromStatus,
  createClientEnvelope,
  encoderInteractionFromOperation,
  keyroProtocolVersion,
  profileToDto,
  snapshotToMessage,
  type AssignmentDto,
  type ClientEnvelope,
  type ClientMessage,
  type ControlDto,
  type ErrorCode,
  type ErrorMessage,
  type ServerMessage
} from "./core-protocol";

export type CoreProtocolHandlerOptions = {
  coreVersion: string;
};

type DecodeResult =
  | { ok: true; value: ClientEnvelope }
  | { ok: false; requestId: string | null; code: ErrorCode; message: string };

export async function handleCoreProtocolInput(
  service: StudioService,
  input: unknown,
  options: CoreProtocolHandlerOptions
): Promise<ServerMessage> {
  const envelope = decodeClientEnvelope(input);
  if (!envelope.ok) return errorMessage(envelope.requestId, envelope.code, envelope.message);
  return handleCoreProtocolEnvelope(service, envelope.value, options);
}

export async function handleCoreProtocolEnvelope(
  service: StudioService,
  envelope: ClientEnvelope,
  options: CoreProtocolHandlerOptions
): Promise<ServerMessage> {
  return handleCoreProtocolMessage(service, envelope.request_id, envelope.message, options);
}

export async function handleCoreProtocolMessage(
  service: StudioService,
  requestId: string,
  message: ClientMessage,
  options: CoreProtocolHandlerOptions
): Promise<ServerMessage> {
  switch (message.type) {
    case "handshake":
      if (message.component !== "studio" || !isCompatibleProtocol(message.protocol)) {
        return errorMessage(requestId, "incompatible_protocol", "Keyro Studio and Core protocol versions are incompatible.");
      }
      return {
        type: "handshake_accepted",
        request_id: requestId,
        core_version: options.coreVersion,
        protocol: keyroProtocolVersion
      };

    case "list_profiles": {
      const snapshot = await service.getSnapshot();
      if (!snapshot.ok) return errorFromResult(requestId, snapshot);
      return {
        type: "profiles",
        request_id: requestId,
        profiles: snapshot.value.profiles.map(profileToDto)
      };
    }

    case "get_snapshot": {
      const snapshot = await service.getSnapshot();
      if (!snapshot.ok) return errorFromResult(requestId, snapshot);
      return snapshotToMessage(requestId, snapshot.value);
    }

    case "create_profile": {
      const created = await service.createProfile(message.name);
      if (!created.ok) return errorFromResult(requestId, created);
      return {
        type: "profile",
        request_id: requestId,
        profile: profileToDto(created.value)
      };
    }

    case "rename_profile": {
      const renamed = await service.renameProfile(message.profile_id, message.name);
      if (!renamed.ok) return errorFromResult(requestId, renamed);
      return {
        type: "profile",
        request_id: requestId,
        profile: profileToDto(renamed.value)
      };
    }

    case "set_active_profile": {
      const activated = await service.activateProfile(message.profile_id);
      if (!activated.ok) return errorFromResult(requestId, activated);
      return acknowledged(requestId);
    }

    case "save_assignment":
      return saveAssignment(service, requestId, message.assignment);

    case "clear_assignment":
      return clearAssignment(service, requestId, message.profile_id, message.control);

    case "virtual_control_input": {
      const snapshot = await service.getSnapshot();
      if (!snapshot.ok) return errorFromResult(requestId, snapshot);
      const activeProfileId = snapshot.value.activeProfileId;
      if (!activeProfileId) return errorMessage(requestId, "validation_failed", "No active profile is available.");

      const input = virtualInputFromControl(activeProfileId, message.control);
      const status = await service.sendVirtualInput(input);
      if (!status.ok) return errorFromResult(requestId, status);
      return acknowledged(requestId);
    }
  }
}

export function actionEventMessageFromStatus(
  status: Parameters<typeof actionEventDtoFromStatus>[0],
  executionId: string
): ServerMessage | null {
  const event = actionEventDtoFromStatus(status, executionId);
  return event ? { type: "action_event", event } : null;
}

export function handshakeEnvelope(requestId: string, componentVersion: string): ClientEnvelope {
  return createClientEnvelope(requestId, {
    type: "handshake",
    component: "studio",
    component_version: componentVersion,
    protocol: keyroProtocolVersion
  });
}

async function saveAssignment(
  service: StudioService,
  requestId: string,
  assignment: AssignmentDto
): Promise<ServerMessage> {
  const action = createOpenUrlAction(assignment.action.url);
  if (!action.ok) return errorFromResult(requestId, action);

  const snapshot = await service.getSnapshot();
  if (!snapshot.ok) return errorFromResult(requestId, snapshot);

  const profile = snapshot.value.profiles.find((candidate) => candidate.id === assignment.profile_id);
  if (!profile) return errorMessage(requestId, "validation_failed", "Profile was not found.");

  const page = profile.pages[assignment.control.page];
  if (!page) return errorMessage(requestId, "validation_failed", "Page is outside the device layout.");

  const nextPage = structuredClone(page);
  const assigned = assignAction(nextPage, assignment.control, action.value);
  if (!assigned.ok) return errorFromResult(requestId, assigned);

  const saved = await service.savePage(assignment.profile_id, nextPage);
  if (!saved.ok) return errorFromResult(requestId, saved);
  return acknowledged(requestId);
}

async function clearAssignment(
  service: StudioService,
  requestId: string,
  profileId: string,
  control: ControlDto
): Promise<ServerMessage> {
  const snapshot = await service.getSnapshot();
  if (!snapshot.ok) return errorFromResult(requestId, snapshot);

  const profile = snapshot.value.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) return errorMessage(requestId, "not_found", "Profile was not found.");

  const page = profile.pages[control.page];
  if (!page) return errorMessage(requestId, "validation_failed", "Page is outside the device layout.");

  const nextPage = structuredClone(page);
  const cleared = clearAction(nextPage, control);
  if (!cleared.ok) return errorFromResult(requestId, cleared);

  const saved = await service.savePage(profileId, nextPage);
  if (!saved.ok) return errorFromResult(requestId, saved);
  return acknowledged(requestId);
}

function assignAction(page: PageConfig, control: ControlDto, action: AssignmentDto["action"]): Result<PageConfig> {
  if (control.kind === "key") {
    const key = page.keys[control.key];
    if (!key) {
      return {
        ok: false,
        error: { code: "validation_error", message: "Key is outside the device layout." }
      };
    }
    key.action = action;
    return { ok: true, value: page };
  }

  const encoder = page.encoders[control.encoder];
  if (!encoder) {
    return {
      ok: false,
      error: { code: "validation_error", message: "Encoder is outside the device layout." }
    };
  }
  encoder[encoderInteractionFromOperation(control.operation)] = action;
  return { ok: true, value: page };
}

function clearAction(page: PageConfig, control: ControlDto): Result<PageConfig> {
  if (control.kind === "key") {
    const key = page.keys[control.key];
    if (!key) {
      return {
        ok: false,
        error: { code: "validation_error", message: "Key is outside the device layout." }
      };
    }
    key.action = null;
    return { ok: true, value: page };
  }

  const encoder = page.encoders[control.encoder];
  if (!encoder) {
    return {
      ok: false,
      error: { code: "validation_error", message: "Encoder is outside the device layout." }
    };
  }
  encoder[encoderInteractionFromOperation(control.operation)] = null;
  return { ok: true, value: page };
}

function virtualInputFromControl(profileId: string, control: ControlDto) {
  if (control.kind === "key") {
    return {
      type: "key" as const,
      profileId,
      pageIndex: control.page,
      keyIndex: control.key
    };
  }
  return {
    type: "encoder" as const,
    profileId,
    pageIndex: control.page,
    encoderIndex: control.encoder,
    interaction: encoderInteractionFromOperation(control.operation)
  };
}

function acknowledged(requestId: string): ServerMessage {
  return {
    type: "acknowledged",
    request_id: requestId
  };
}

function errorFromResult(requestId: string, result: Result<unknown>): ErrorMessage {
  if (result.ok) {
    return errorMessage(requestId, "internal", "Expected a failed result.");
  }
  return errorMessage(requestId, errorCodeFromAppCode(result.error.code), result.error.message);
}

function errorMessage(requestId: string | null, code: ErrorCode, message: string): ErrorMessage {
  return {
    type: "error",
    request_id: requestId,
    error: { code, message }
  };
}

function errorCodeFromAppCode(code: string): ErrorCode {
  if (code === "not_found") return "not_found";
  if (code === "validation_error" || code === "invalid_url") return "validation_failed";
  return "internal";
}

function isCompatibleProtocol(protocol: { major: number; minor: number }): boolean {
  return protocol.major === keyroProtocolVersion.major && protocol.minor === keyroProtocolVersion.minor;
}

function decodeClientEnvelope(input: unknown): DecodeResult {
  if (!isRecord(input)) {
    return { ok: false, requestId: null, code: "validation_failed", message: "Envelope must be an object." };
  }
  const requestId = input.request_id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return { ok: false, requestId: null, code: "validation_failed", message: "Envelope request_id is required." };
  }
  const message = input.message;
  if (!isRecord(message) || typeof message.type !== "string") {
    return { ok: false, requestId, code: "validation_failed", message: "Envelope message is required." };
  }

  const decoded = decodeClientMessage(message);
  if (!decoded.ok) return { ...decoded, requestId };
  return { ok: true, value: { request_id: requestId, message: decoded.value } };
}

type MessageDecodeResult =
  | { ok: true; value: ClientMessage }
  | { ok: false; requestId: string; code: ErrorCode; message: string };

function decodeClientMessage(message: Record<string, unknown>): MessageDecodeResult {
  switch (message.type) {
    case "handshake":
      if (
        message.component !== "studio" ||
        typeof message.component_version !== "string" ||
        !isProtocolVersion(message.protocol)
      ) {
        return invalidMessage("Handshake message is malformed.");
      }
      if (!isCompatibleProtocol(message.protocol)) {
        return { ok: false, requestId: "", code: "incompatible_protocol", message: "Keyro Studio and Core protocol versions are incompatible." };
      }
      return {
        ok: true,
        value: {
          type: "handshake",
          component: "studio",
          component_version: message.component_version,
          protocol: keyroProtocolVersion
        }
      };

    case "list_profiles":
      return { ok: true, value: { type: "list_profiles" } };

    case "get_snapshot":
      return { ok: true, value: { type: "get_snapshot" } };

    case "create_profile":
      if (typeof message.name !== "string") {
        return invalidMessage("create_profile name is required.");
      }
      return { ok: true, value: { type: "create_profile", name: message.name } };

    case "rename_profile":
      if (typeof message.profile_id !== "string" || message.profile_id.length === 0) {
        return invalidMessage("rename_profile profile_id is required.");
      }
      if (typeof message.name !== "string") {
        return invalidMessage("rename_profile name is required.");
      }
      return { ok: true, value: { type: "rename_profile", profile_id: message.profile_id, name: message.name } };

    case "set_active_profile":
      if (typeof message.profile_id !== "string" || message.profile_id.length === 0) {
        return invalidMessage("set_active_profile profile_id is required.");
      }
      return { ok: true, value: { type: "set_active_profile", profile_id: message.profile_id } };

    case "save_assignment":
      if (!isAssignmentDto(message.assignment)) return invalidMessage("save_assignment assignment is malformed.");
      return { ok: true, value: { type: "save_assignment", assignment: message.assignment } };

    case "clear_assignment":
      if (typeof message.profile_id !== "string" || message.profile_id.length === 0) {
        return invalidMessage("clear_assignment profile_id is required.");
      }
      if (!isControlDto(message.control)) return invalidMessage("clear_assignment control is malformed.");
      return { ok: true, value: { type: "clear_assignment", profile_id: message.profile_id, control: message.control } };

    case "virtual_control_input":
      if (!isControlDto(message.control)) return invalidMessage("virtual_control_input control is malformed.");
      return { ok: true, value: { type: "virtual_control_input", control: message.control } };

    default:
      return { ok: false, requestId: "", code: "unknown_message", message: "Message type is not supported." };
  }
}

function invalidMessage(message: string): MessageDecodeResult {
  return { ok: false, requestId: "", code: "validation_failed", message };
}

function isAssignmentDto(input: unknown): input is AssignmentDto {
  if (!isRecord(input)) return false;
  return typeof input.profile_id === "string" && isControlDto(input.control) && isActionDto(input.action);
}

function isControlDto(input: unknown): input is ControlDto {
  if (!isRecord(input)) return false;
  if (input.kind === "key") {
    return isNonNegativeInteger(input.page) && isNonNegativeInteger(input.key);
  }
  if (input.kind === "encoder") {
    return (
      isNonNegativeInteger(input.page) &&
      isNonNegativeInteger(input.encoder) &&
      (input.operation === "left" || input.operation === "right" || input.operation === "press")
    );
  }
  return false;
}

function isActionDto(input: unknown): input is AssignmentDto["action"] {
  return isRecord(input) && input.kind === "open_url" && typeof input.url === "string";
}

function isProtocolVersion(input: unknown): input is { major: number; minor: number } {
  return isRecord(input) && isNonNegativeInteger(input.major) && isNonNegativeInteger(input.minor);
}

function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isInteger(input) && input >= 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
