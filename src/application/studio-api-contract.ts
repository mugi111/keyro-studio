import type {
  ActionExecutionStatus,
  ConnectionStatus,
  CoreEvent,
  VirtualInput
} from "./ports/core-port";
import type { PageConfig, StudioSnapshot } from "../domain/profile";
import type { DeviceLayout } from "../shared/device-layout";
import type { Result } from "../shared/result";

export type StudioRequests = {
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

export type StudioMessages = {
  uiReady: { at: number };
};

export type StudioEvents = {
  coreEvent: CoreEvent;
};
