import type { CorePort } from "../../application/ports/core-port";
import { MockActionExecutor } from "./mock-action-executor";
import { MockCoreAdapter } from "./mock-core-adapter";
import { UnavailableCoreAdapter } from "./unavailable-core-adapter";

export type CoreAdapterMode = "mock" | "local-ipc";

export type CoreAdapterConfig = {
  mode: CoreAdapterMode;
};

export function readCoreAdapterConfig(env: Record<string, string | undefined> = process.env): CoreAdapterConfig {
  const mode = env.KEYRO_STUDIO_CORE_MODE;
  if (mode === "local-ipc") return { mode };
  return { mode: "mock" };
}

export function createCoreAdapter(config: CoreAdapterConfig): CorePort {
  if (config.mode === "local-ipc") {
    return new UnavailableCoreAdapter(
      "Keyro Core local IPC is not wired yet because keyro-protocol is still undefined."
    );
  }

  return new MockCoreAdapter({ actionExecutor: new MockActionExecutor() });
}
