import { describe, expect, test } from "bun:test";
import { StudioService } from "../src/application/studio-service";
import { createCoreAdapter, readCoreAdapterConfig } from "../src/infrastructure/main/core-adapter-factory";
import { registerAppLifecycle } from "../src/infrastructure/main/app-lifecycle";
import { MockActionExecutor } from "../src/infrastructure/main/mock-action-executor";

describe("core adapter factory", () => {
  test("defaults to mock mode", async () => {
    const config = readCoreAdapterConfig({});
    const service = new StudioService(createCoreAdapter(config));
    const snapshot = await service.getSnapshot();

    expect(config.mode).toBe("mock");
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.profiles[0]?.name).toBe("Default");
    }
  });

  test("exposes unavailable local-ipc adapter until protocol exists", async () => {
    const config = readCoreAdapterConfig({ KEYRO_STUDIO_CORE_MODE: "local-ipc" });
    const service = new StudioService(createCoreAdapter(config));

    expect(config.mode).toBe("local-ipc");
    expect((await service.getConnectionStatus()).state).toBe("disconnected");
    expect((await service.createProfile("Nope")).ok).toBe(false);
  });

  test("ignores unknown modes to keep development usable", () => {
    expect(readCoreAdapterConfig({ KEYRO_STUDIO_CORE_MODE: "something-else" }).mode).toBe("mock");
  });
});

describe("mock action executor", () => {
  test("returns user-facing success and failure states", async () => {
    const executor = new MockActionExecutor();

    const success = await executor.execute({ kind: "open_url", url: "https://example.com/" }, "Key 1");
    const failure = await executor.execute({ kind: "open_url", url: "https://fail.example.com/" }, "Key 2");

    expect(success.state).toBe("success");
    expect(failure.state).toBe("failure");
    if (failure.state === "failure") {
      expect(failure.message).not.toContain("Error:");
      expect(failure.message).toContain("Mock action executor");
    }
  });
});

describe("app lifecycle", () => {
  test("closes service on process termination signals", async () => {
    const events = new Map<string, (...args: unknown[]) => void>();
    let closeCount = 0;
    let quitCount = 0;
    const service = {
      close: async () => {
        closeCount += 1;
      }
    } as StudioService;
    const proc = {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        events.set(event, listener);
        return proc;
      }
    } as unknown as NodeJS.Process;

    registerAppLifecycle(service, () => {
      quitCount += 1;
    }, proc);

    await events.get("SIGINT")?.();
    await events.get("SIGTERM")?.();
    events.get("beforeExit")?.();

    expect(closeCount).toBe(3);
    expect(quitCount).toBe(2);
  });
});
