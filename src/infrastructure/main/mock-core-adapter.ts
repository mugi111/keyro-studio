import { defaultDeviceLayout, validateDeviceLayout, type DeviceLayout } from "../../shared/device-layout";
import { err, ok, type Result } from "../../shared/result";
import {
  cloneSnapshot,
  createEmptyProfile,
  validatePageConfig,
  type PageConfig,
  type Profile,
  type StudioSnapshot
} from "../../domain/profile";
import { StudioService } from "../../application/studio-service";
import type { ActionExecutionStatus, ActionExecutorPort } from "../../application/ports/action-executor-port";
import type {
  ConnectionStatus,
  CoreEvent,
  CorePort,
  Unsubscribe,
  VirtualInput
} from "../../application/ports/core-port";
import { MockActionExecutor } from "./mock-action-executor";

type MockCoreOptions = {
  layout?: DeviceLayout;
  actionExecutor?: ActionExecutorPort;
};

export class MockCoreAdapter implements CorePort {
  private status: ConnectionStatus = { state: "connected" };
  private snapshot: StudioSnapshot;
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  private readonly actionExecutor: ActionExecutorPort;

  constructor(options: MockCoreOptions = {}) {
    const layout = validateDeviceLayout(options.layout ?? defaultDeviceLayout);
    if (!layout.ok) {
      throw new Error(layout.error.message);
    }
    const defaultProfile = createEmptyProfile("profile-default", "Default", layout.value, true);
    this.snapshot = {
      layout: layout.value,
      profiles: [defaultProfile],
      activeProfileId: defaultProfile.id
    };
    this.actionExecutor = options.actionExecutor ?? new MockActionExecutor();
  }

  subscribe(listener: (event: CoreEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    listener({ type: "connection", status: this.status });
    listener({ type: "snapshot", snapshot: cloneSnapshot(this.snapshot) });
    return () => this.listeners.delete(listener);
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.status;
  }

  async getSnapshot(): Promise<Result<StudioSnapshot>> {
    if (!this.isConnected()) {
      return err("core_unavailable", "Core is disconnected.");
    }
    return ok(cloneSnapshot(this.snapshot));
  }

  async getDeviceLayout(): Promise<Result<DeviceLayout>> {
    if (!this.isConnected()) {
      return err("core_unavailable", "Core is disconnected.");
    }
    return ok(this.snapshot.layout);
  }

  async createProfile(name: string): Promise<Result<Profile>> {
    if (!this.isConnected()) return err("core_unavailable", "Core is disconnected.");
    const profile = createEmptyProfile(`profile-${Date.now()}-${this.snapshot.profiles.length}`, name, this.snapshot.layout);
    this.snapshot = {
      ...this.snapshot,
      profiles: [...this.snapshot.profiles, profile]
    };
    this.emitSnapshot();
    return ok(structuredClone(profile));
  }

  async renameProfile(profileId: string, name: string): Promise<Result<Profile>> {
    if (!this.isConnected()) return err("core_unavailable", "Core is disconnected.");
    const profile = this.findProfile(profileId);
    if (!profile) return err("not_found", "Profile was not found.");
    const renamed = createEmptyProfile(profile.id, name, this.snapshot.layout, profile.active);
    renamed.pages = profile.pages;
    this.snapshot = {
      ...this.snapshot,
      profiles: this.snapshot.profiles.map((candidate) => (candidate.id === profileId ? renamed : candidate))
    };
    this.emitSnapshot();
    return ok(structuredClone(renamed));
  }

  async activateProfile(profileId: string): Promise<Result<StudioSnapshot>> {
    if (!this.isConnected()) return err("core_unavailable", "Core is disconnected.");
    if (!this.findProfile(profileId)) return err("not_found", "Profile was not found.");
    this.snapshot = {
      ...this.snapshot,
      activeProfileId: profileId,
      profiles: this.snapshot.profiles.map((profile) => ({
        ...profile,
        active: profile.id === profileId
      }))
    };
    this.emitSnapshot();
    return ok(cloneSnapshot(this.snapshot));
  }

  async savePage(profileId: string, page: PageConfig): Promise<Result<StudioSnapshot>> {
    if (!this.isConnected()) return err("core_unavailable", "Core is disconnected.");
    const validated = validatePageConfig(page, this.snapshot.layout);
    if (!validated.ok) return validated;
    if (!this.findProfile(profileId)) return err("not_found", "Profile was not found.");
    this.snapshot = {
      ...this.snapshot,
      profiles: this.snapshot.profiles.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              pages: profile.pages.map((candidate) =>
                candidate.index === page.index ? structuredClone(page) : candidate
              )
            }
          : profile
      )
    };
    this.emitSnapshot();
    return ok(cloneSnapshot(this.snapshot));
  }

  async sendVirtualInput(input: VirtualInput): Promise<Result<ActionExecutionStatus>> {
    if (!this.isConnected()) return err("core_unavailable", "Core is disconnected.");
    const action = this.resolveAction(input);
    const target = describeInput(input);
    this.emit({ type: "action", status: { state: "running", target } });

    if (!action) {
      const status: ActionExecutionStatus = {
        state: "failure",
        target,
        message: "No action is assigned to this control."
      };
      this.emit({ type: "action", status });
      return ok(status);
    }

    let status: ActionExecutionStatus;
    try {
      status = await this.actionExecutor.execute(action, target);
    } catch {
      status = {
        state: "failure",
        target,
        message: "Action execution failed. Check the action settings and try again."
      };
    }

    this.emit({ type: "action", status });
    return ok(status);
  }

  async simulateDisconnect(): Promise<ConnectionStatus> {
    this.status = { state: "disconnected", reason: "Mock disconnect requested." };
    this.emit({ type: "connection", status: this.status });
    return this.status;
  }

  async simulateReconnect(): Promise<ConnectionStatus> {
    this.status = { state: "reconnecting", reason: "Mock reconnect requested." };
    this.emit({ type: "connection", status: this.status });
    await Promise.resolve();
    this.status = { state: "connected" };
    this.emit({ type: "connection", status: this.status });
    this.emitSnapshot();
    return this.status;
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }

  private findProfile(profileId: string): Profile | undefined {
    return this.snapshot.profiles.find((profile) => profile.id === profileId);
  }

  private resolveAction(input: VirtualInput) {
    const profile = this.findProfile(input.profileId);
    const page = profile?.pages[input.pageIndex];
    if (!page) return null;
    if (input.type === "key") {
      return page.keys[input.keyIndex]?.action;
    }
    const encoder = page.encoders[input.encoderIndex];
    return encoder?.[input.interaction] ?? null;
  }

  private isConnected(): boolean {
    return this.status.state === "connected";
  }

  private emitSnapshot(): void {
    this.emit({ type: "snapshot", snapshot: cloneSnapshot(this.snapshot) });
  }

  private emit(event: CoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function describeInput(input: VirtualInput): string {
  if (input.type === "key") {
    return `Page ${input.pageIndex + 1} Key ${input.keyIndex + 1}`;
  }
  return `Page ${input.pageIndex + 1} Encoder ${input.encoderIndex + 1} ${input.interaction}`;
}

export function createMockStudioService(options?: MockCoreOptions): StudioService {
  return new StudioService(new MockCoreAdapter(options));
}
