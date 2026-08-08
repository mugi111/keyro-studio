import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";
import type {
  ActionExecutionStatus,
  ConnectionStatus,
  CoreEvent,
  VirtualInput
} from "../application/ports/core-port";
import type { PageConfig, StudioSnapshot } from "../domain/profile";
import type { DeviceLayout } from "./device-layout";
import type { Result } from "./result";

export type StudioBunRPC = RPCSchema<{
  requests: {
    getConnectionStatus: {
      params: undefined;
      response: ConnectionStatus;
    };
    getSnapshot: {
      params: undefined;
      response: Result<StudioSnapshot>;
    };
    getDeviceLayout: {
      params: undefined;
      response: Result<DeviceLayout>;
    };
    createProfile: {
      params: { name: string };
      response: Result<StudioSnapshot>;
    };
    renameProfile: {
      params: { profileId: string; name: string };
      response: Result<StudioSnapshot>;
    };
    activateProfile: {
      params: { profileId: string };
      response: Result<StudioSnapshot>;
    };
    savePage: {
      params: { profileId: string; page: PageConfig };
      response: Result<StudioSnapshot>;
    };
    sendVirtualInput: {
      params: { input: VirtualInput };
      response: Result<ActionExecutionStatus>;
    };
    simulateDisconnect: {
      params: undefined;
      response: ConnectionStatus;
    };
    simulateReconnect: {
      params: undefined;
      response: ConnectionStatus;
    };
  };
  messages: {
    uiReady: { at: number };
  };
}>;

export type StudioWebviewRPC = RPCSchema<{
  requests: {};
  messages: {
    coreEvent: CoreEvent;
  };
}>;

export interface StudioRPC extends ElectrobunRPCSchema {
  bun: StudioBunRPC;
  webview: StudioWebviewRPC;
}
