import type { DeviceLayout } from "../../shared/device-layout";
import type { Result } from "../../shared/result";
import type { PageConfig, Profile, StudioSnapshot } from "../../domain/profile";
import type { ActionExecutionStatus } from "./action-executor-port";

export type ConnectionStatus =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "disconnected"; reason?: string }
  | { state: "reconnecting"; reason?: string }
  | { state: "error"; message: string };

export type VirtualInput =
  | { type: "key"; profileId: string; pageIndex: number; keyIndex: number }
  | {
      type: "encoder";
      profileId: string;
      pageIndex: number;
      encoderIndex: number;
      interaction: "rotateLeft" | "rotateRight" | "press";
    };

export type CoreEvent =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "snapshot"; snapshot: StudioSnapshot }
  | { type: "action"; status: ActionExecutionStatus };

export type Unsubscribe = () => void;

export interface CorePort {
  subscribe(listener: (event: CoreEvent) => void): Unsubscribe;
  getConnectionStatus(): Promise<ConnectionStatus>;
  getSnapshot(): Promise<Result<StudioSnapshot>>;
  getDeviceLayout(): Promise<Result<DeviceLayout>>;
  createProfile(name: string): Promise<Result<Profile>>;
  renameProfile(profileId: string, name: string): Promise<Result<Profile>>;
  activateProfile(profileId: string): Promise<Result<StudioSnapshot>>;
  savePage(profileId: string, page: PageConfig): Promise<Result<StudioSnapshot>>;
  sendVirtualInput(input: VirtualInput): Promise<Result<ActionExecutionStatus>>;
  simulateDisconnect(): Promise<ConnectionStatus>;
  simulateReconnect(): Promise<ConnectionStatus>;
  close(): Promise<void>;
}
