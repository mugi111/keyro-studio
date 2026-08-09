import type { CorePort } from "../../application/ports/core-port";
import {
  createActionExecutor,
  readActionExecutorMode,
  type ActionExecutorFactoryDeps,
  type ActionExecutorMode
} from "./action-executor-factory";
import { MockCoreAdapter } from "./mock-core-adapter";
import { UnavailableCoreAdapter } from "./unavailable-core-adapter";
import { protocolPackageUnavailableReason } from "./protocol-readiness";

export type CoreAdapterMode = "mock" | "local-ipc";

export type CoreAdapterConfig = {
  mode: CoreAdapterMode;
  actionExecutorMode: ActionExecutorMode;
};

export function readCoreAdapterConfig(env: Record<string, string | undefined> = process.env): CoreAdapterConfig {
  const mode = env.KEYRO_STUDIO_CORE_MODE;
  return {
    mode: mode === "local-ipc" ? mode : "mock",
    actionExecutorMode: readActionExecutorMode(env)
  };
}

export type CoreAdapterFactoryDeps = ActionExecutorFactoryDeps;

export function createCoreAdapter(config: CoreAdapterConfig, deps: CoreAdapterFactoryDeps = {}): CorePort {
  if (config.mode === "local-ipc") {
    return new UnavailableCoreAdapter(protocolPackageUnavailableReason());
  }

  return new MockCoreAdapter({ actionExecutor: createActionExecutor(config.actionExecutorMode, deps) });
}
