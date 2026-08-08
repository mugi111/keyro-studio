import type { ActionExecutorPort } from "../../application/ports/action-executor-port";
import { MockActionExecutor } from "./mock-action-executor";
import { OsOpenUrlExecutor, type OpenUrlFn } from "./os-open-url-executor";

export type ActionExecutorMode = "mock" | "os-open-url";

export function readActionExecutorMode(env: Record<string, string | undefined> = process.env): ActionExecutorMode {
  return env.KEYRO_STUDIO_ACTION_EXECUTOR === "os-open-url" ? "os-open-url" : "mock";
}

export type ActionExecutorFactoryDeps = {
  openUrl?: OpenUrlFn;
};

export function createActionExecutor(mode: ActionExecutorMode, deps: ActionExecutorFactoryDeps = {}): ActionExecutorPort {
  if (mode === "os-open-url") {
    return new OsOpenUrlExecutor(
      deps.openUrl ??
        (() => {
          throw new Error("No OS URL opener is configured.");
        })
    );
  }
  return new MockActionExecutor();
}
