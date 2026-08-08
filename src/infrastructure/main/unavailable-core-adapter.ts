import { defaultDeviceLayout, type DeviceLayout } from "../../shared/device-layout";
import { err, ok, type Result } from "../../shared/result";
import { createEmptyProfile, type PageConfig, type Profile, type StudioSnapshot } from "../../domain/profile";
import type {
  ActionExecutionStatus,
  ConnectionStatus,
  CoreEvent,
  CorePort,
  Unsubscribe,
  VirtualInput
} from "../../application/ports/core-port";

export class UnavailableCoreAdapter implements CorePort {
  private readonly listeners = new Set<(event: CoreEvent) => void>();
  private readonly status: ConnectionStatus;
  private readonly snapshot: StudioSnapshot;

  constructor(reason: string) {
    this.status = { state: "disconnected", reason };
    const fallbackProfile = createEmptyProfile("profile-unavailable", "Unavailable Core", defaultDeviceLayout, true);
    this.snapshot = {
      layout: defaultDeviceLayout,
      profiles: [fallbackProfile],
      activeProfileId: fallbackProfile.id
    };
  }

  subscribe(listener: (event: CoreEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    listener({ type: "connection", status: this.status });
    listener({ type: "snapshot", snapshot: structuredClone(this.snapshot) });
    return () => this.listeners.delete(listener);
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.status;
  }

  async getSnapshot(): Promise<Result<StudioSnapshot>> {
    return ok(structuredClone(this.snapshot));
  }

  async getDeviceLayout(): Promise<Result<DeviceLayout>> {
    return ok(this.snapshot.layout);
  }

  async createProfile(_name: string): Promise<Result<Profile>> {
    return this.coreUnavailable();
  }

  async renameProfile(_profileId: string, _name: string): Promise<Result<Profile>> {
    return this.coreUnavailable();
  }

  async activateProfile(_profileId: string): Promise<Result<StudioSnapshot>> {
    return this.coreUnavailable();
  }

  async savePage(_profileId: string, _page: PageConfig): Promise<Result<StudioSnapshot>> {
    return this.coreUnavailable();
  }

  async sendVirtualInput(_input: VirtualInput): Promise<Result<ActionExecutionStatus>> {
    return this.coreUnavailable();
  }

  async simulateDisconnect(): Promise<ConnectionStatus> {
    this.emit({ type: "connection", status: this.status });
    return this.status;
  }

  async simulateReconnect(): Promise<ConnectionStatus> {
    const status: ConnectionStatus = {
      state: "error",
      message: "Reconnect requires the real keyro-protocol local IPC adapter."
    };
    this.emit({ type: "connection", status });
    return status;
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }

  private coreUnavailable(): Result<never> {
    return err("core_unavailable", "Keyro Core IPC adapter is not available yet.");
  }

  private emit(event: CoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
