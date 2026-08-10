import type { CorePort } from "../../application/ports/core-port";
import {
  createActionExecutor,
  readActionExecutorMode,
  type ActionExecutorFactoryDeps,
  type ActionExecutorMode
} from "./action-executor-factory";
import { LocalIpcCoreAdapter, type LocalIpcCoreAdapterOptions } from "./local-ipc-core-adapter";
import { MockCoreAdapter } from "./mock-core-adapter";

export type CoreAdapterMode = "mock" | "local-ipc";

export type CoreAdapterConfig = {
  mode: CoreAdapterMode;
  actionExecutorMode: ActionExecutorMode;
  socketPath?: string;
};

export function readCoreAdapterConfig(env: Record<string, string | undefined> = process.env): CoreAdapterConfig {
  const mode = env.KEYRO_STUDIO_CORE_MODE;
  const socketPath = env.KEYRO_STUDIO_CORE_SOCKET;
  const config: CoreAdapterConfig = {
    mode: mode === "local-ipc" ? mode : "mock",
    actionExecutorMode: readActionExecutorMode(env)
  };
  if (socketPath) config.socketPath = socketPath;
  return config;
}

export type CoreAdapterFactoryDeps = ActionExecutorFactoryDeps & {
  localIpc?: LocalIpcCoreAdapterOptions;
};

export function createCoreAdapter(config: CoreAdapterConfig, deps: CoreAdapterFactoryDeps = {}): CorePort {
  if (config.mode === "local-ipc") {
    return new LocalIpcCoreAdapter({ socketPath: config.socketPath, ...deps.localIpc });
  }

  return new MockCoreAdapter({ actionExecutor: createActionExecutor(config.actionExecutorMode, deps) });
}
