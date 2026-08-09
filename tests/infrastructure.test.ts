import { describe, expect, test } from "bun:test";
import { StudioService } from "../src/application/studio-service";
import { createActionExecutor, readActionExecutorMode } from "../src/infrastructure/main/action-executor-factory";
import { createCoreAdapter, readCoreAdapterConfig } from "../src/infrastructure/main/core-adapter-factory";
import { registerAppLifecycle } from "../src/infrastructure/main/app-lifecycle";
import {
  handleCoreProtocolEnvelope,
  handleCoreProtocolInput,
  handshakeEnvelope
} from "../src/infrastructure/main/core-protocol-handler";
import {
  KEYRO_PROTOCOL_VERSION,
  actionEventDtoFromStatus,
  controlDtoFromActionTarget,
  controlDtoFromVirtualInput,
  createClientEnvelope,
  keyroProtocolVersion
} from "../src/infrastructure/main/core-protocol";
import { MockActionExecutor } from "../src/infrastructure/main/mock-action-executor";
import { MockCoreAdapter } from "../src/infrastructure/main/mock-core-adapter";
import { OsOpenUrlExecutor } from "../src/infrastructure/main/os-open-url-executor";
import {
  plannedCoreStudioProtocolTag,
  protocolPackageName,
  protocolPackageUnavailableReason
} from "../src/infrastructure/main/protocol-readiness";
import type { ActionExecutionTarget } from "../src/application/ports/action-executor-port";

const keyTarget: ActionExecutionTarget = {
  type: "key",
  profileId: "profile-default",
  pageIndex: 0,
  keyIndex: 0
};

const secondKeyTarget: ActionExecutionTarget = {
  type: "key",
  profileId: "profile-default",
  pageIndex: 0,
  keyIndex: 1
};

describe("core adapter factory", () => {
  test("defaults to mock mode", async () => {
    const config = readCoreAdapterConfig({});
    const service = new StudioService(createCoreAdapter(config));
    const snapshot = await service.getSnapshot();

    expect(config.mode).toBe("mock");
    expect(config.actionExecutorMode).toBe("mock");
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.profiles[0]?.name).toBe("Default");
    }
  });

  test("exposes unavailable local-ipc adapter until protocol exists", async () => {
    const config = readCoreAdapterConfig({ KEYRO_STUDIO_CORE_MODE: "local-ipc" });
    const service = new StudioService(createCoreAdapter(config));

    expect(config.mode).toBe("local-ipc");
    expect(config.actionExecutorMode).toBe("mock");
    expect((await service.getConnectionStatus()).state).toBe("disconnected");
    const result = await service.createProfile("Nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Keyro Core IPC adapter is not available yet.");
    }
  });

  test("ignores unknown modes to keep development usable", () => {
    expect(readCoreAdapterConfig({ KEYRO_STUDIO_CORE_MODE: "something-else" }).mode).toBe("mock");
  });

  test("reads action executor mode independently from core adapter mode", () => {
    expect(readCoreAdapterConfig({ KEYRO_STUDIO_ACTION_EXECUTOR: "os-open-url" })).toEqual({
      mode: "mock",
      actionExecutorMode: "os-open-url"
    });
    expect(readCoreAdapterConfig({ KEYRO_STUDIO_ACTION_EXECUTOR: "anything-else" }).actionExecutorMode).toBe("mock");
  });

  test("keeps protocol package readiness in the main adapter boundary", () => {
    expect(protocolPackageName).toBe("@keyro/protocol");
    expect(plannedCoreStudioProtocolTag).toBe("v0.1.0");
    expect(protocolPackageUnavailableReason()).toContain("@keyro/protocol v0.1.0");
    expect(protocolPackageUnavailableReason()).toContain("temporary TypeScript contract");
  });
});

describe("temporary Core protocol v0.1.0", () => {
  test("keeps versioned DTO helpers in the infrastructure boundary", () => {
    expect(KEYRO_PROTOCOL_VERSION).toBe("0.1.0");
    expect(keyroProtocolVersion).toEqual({ major: 0, minor: 1 });
    expect(handshakeEnvelope("request-1", "0.0.0")).toEqual({
      request_id: "request-1",
      message: {
        type: "handshake",
        component: "studio",
        component_version: "0.0.0",
        protocol: { major: 0, minor: 1 }
      }
    });
  });

  test("maps Studio controls and action states to protocol DTOs", () => {
    expect(
      controlDtoFromVirtualInput({
        type: "encoder",
        profileId: "profile-default",
        pageIndex: 2,
        encoderIndex: 1,
        interaction: "rotateRight"
      })
    ).toEqual({ kind: "encoder", page: 2, encoder: 1, operation: "right" });

    expect(controlDtoFromActionTarget(keyTarget)).toEqual({ kind: "key", page: 0, key: 0 });
    expect(
      actionEventDtoFromStatus(
        {
          state: "running",
          target: keyTarget
        },
        "execution-1"
      )
    ).toEqual({
      state: "running",
      execution_id: "execution-1",
      profile_id: "profile-default",
      control: { kind: "key", page: 0, key: 0 }
    });
  });

  test("handles handshake and profile listing with request correlation", async () => {
    const service = new StudioService(new MockCoreAdapter());

    const handshake = await handleCoreProtocolEnvelope(service, handshakeEnvelope("request-handshake", "0.0.0"), {
      coreVersion: "core-mock"
    });
    expect(handshake).toEqual({
      type: "handshake_accepted",
      request_id: "request-handshake",
      core_version: "core-mock",
      protocol: { major: 0, minor: 1 }
    });

    const profiles = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-list", { type: "list_profiles" }),
      {
        coreVersion: "core-mock"
      }
    );

    expect(profiles).toEqual({
      type: "profiles",
      request_id: "request-list",
      profiles: [{ id: "profile-default", name: "Default", is_active: true }]
    });
  });

  test("rejects incompatible protocol handshakes", async () => {
    const service = new StudioService(new MockCoreAdapter());

    const response = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-bad-handshake", {
        type: "handshake",
        component: "studio",
        component_version: "0.0.0",
        protocol: { major: 1, minor: 0 }
      }),
      {
        coreVersion: "core-mock"
      }
    );

    expect(response).toEqual({
      type: "error",
      request_id: "request-bad-handshake",
      error: {
        code: "incompatible_protocol",
        message: "Keyro Studio and Core protocol versions are incompatible."
      }
    });
  });

  test("accepts same-major protocol handshakes for minor additions", async () => {
    const service = new StudioService(new MockCoreAdapter());

    const response = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-future-minor", {
        type: "handshake",
        component: "studio",
        component_version: "0.0.0",
        protocol: { major: 0, minor: 2 }
      }),
      {
        coreVersion: "core-mock"
      }
    );

    expect(response.type).toBe("handshake_accepted");
  });

  test("decodes untrusted protocol input before dispatching it", async () => {
    const service = new StudioService(new MockCoreAdapter());

    await expect(
      handleCoreProtocolInput(
        service,
        {
          request_id: "request-wire-list",
          message: { type: "list_profiles" }
        },
        { coreVersion: "core-mock" }
      )
    ).resolves.toEqual({
      type: "profiles",
      request_id: "request-wire-list",
      profiles: [{ id: "profile-default", name: "Default", is_active: true }]
    });

    await expect(
      handleCoreProtocolInput(service, { request_id: "request-unknown", message: { type: "wat" } }, {
        coreVersion: "core-mock"
      })
    ).resolves.toEqual({
      type: "error",
      request_id: "request-unknown",
      error: { code: "unknown_message", message: "Message type is not supported." }
    });

    await expect(
      handleCoreProtocolInput(
        service,
        {
          request_id: "request-bad-control",
          message: { type: "virtual_control_input", control: { kind: "encoder", page: 0, encoder: 0 } }
        },
        { coreVersion: "core-mock" }
      )
    ).resolves.toEqual({
      type: "error",
      request_id: "request-bad-control",
      error: { code: "validation_failed", message: "virtual_control_input control is malformed." }
    });
  });

  test("handles active profile, assignment save, and virtual input messages", async () => {
    const service = new StudioService(new MockCoreAdapter());
    const created = await service.createProfile("Second");
    expect(created.ok).toBe(true);
    const profileId = created.ok ? created.value.id : "missing";

    const activated = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-active", { type: "set_active_profile", profile_id: profileId }),
      {
        coreVersion: "core-mock"
      }
    );
    expect(activated).toEqual({ type: "acknowledged", request_id: "request-active" });

    const saved = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-save", {
        type: "save_assignment",
        assignment: {
          profile_id: profileId,
          control: { kind: "key", page: 0, key: 0 },
          action: { kind: "open_url", url: "https://example.com/a b" }
        }
      }),
      {
        coreVersion: "core-mock"
      }
    );
    expect(saved).toEqual({ type: "acknowledged", request_id: "request-save" });

    const snapshot = await service.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.profiles.find((profile) => profile.id === profileId)?.pages[0]?.keys[0]?.action).toEqual({
        kind: "open_url",
        url: "https://example.com/a%20b"
      });
    }

    const virtualInput = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-virtual", {
        type: "virtual_control_input",
        control: { kind: "key", page: 0, key: 0 }
      }),
      {
        coreVersion: "core-mock"
      }
    );

    expect(virtualInput).toEqual({ type: "acknowledged", request_id: "request-virtual" });
  });

  test("maps structured action failure codes into action events", () => {
    const failed = actionEventDtoFromStatus(
      {
        state: "failure",
        target: keyTarget,
        code: "no_action_assigned",
        message: "No action is assigned to this control."
      },
      "execution-2"
    );

    expect(failed).toEqual({
      state: "failed",
      execution_id: "execution-2",
      code: "no_action_assigned",
      message: "No action is assigned to this control."
    });
  });
});

describe("action executor factory", () => {
  test("defaults to mock executor", () => {
    expect(readActionExecutorMode({})).toBe("mock");
    expect(createActionExecutor("mock")).toBeInstanceOf(MockActionExecutor);
  });

  test("creates the OS open URL executor only when explicitly selected", () => {
    expect(readActionExecutorMode({ KEYRO_STUDIO_ACTION_EXECUTOR: "os-open-url" })).toBe("os-open-url");
    expect(createActionExecutor("os-open-url", { openUrl: () => true })).toBeInstanceOf(OsOpenUrlExecutor);
  });

  test("OS executor mode is safe when an opener is not configured", async () => {
    const executor = createActionExecutor("os-open-url");
    const result = await executor.execute({ kind: "open_url", url: "https://example.com/" }, keyTarget);

    expect(result.state).toBe("failure");
    if (result.state === "failure") {
      expect(result.message).toBe("The operating system could not open the URL.");
    }
  });
});

describe("mock action executor", () => {
  test("returns user-facing success and failure states", async () => {
    const executor = new MockActionExecutor();

    const success = await executor.execute({ kind: "open_url", url: "https://example.com/" }, keyTarget);
    const failure = await executor.execute({ kind: "open_url", url: "https://fail.example.com/" }, secondKeyTarget);

    expect(success.state).toBe("success");
    expect(failure.state).toBe("failure");
    if (failure.state === "failure") {
      expect(failure.message).not.toContain("Error:");
      expect(failure.message).toContain("Mock action executor");
    }
  });
});

describe("OS open URL executor", () => {
  test("opens only validated http and https URLs through the injected opener", async () => {
    const opened: string[] = [];
    const executor = new OsOpenUrlExecutor((url) => {
      opened.push(url);
      return true;
    });

    const result = await executor.execute({ kind: "open_url", url: "https://example.com/a b" }, keyTarget);

    expect(result.state).toBe("success");
    expect(opened).toEqual(["https://example.com/a%20b"]);
  });

  test("does not invoke opener for disallowed URL schemes", async () => {
    let called = false;
    const executor = new OsOpenUrlExecutor(() => {
      called = true;
      return true;
    });

    const result = await executor.execute({ kind: "open_url", url: "javascript:alert(1)" }, keyTarget);

    expect(result.state).toBe("failure");
    expect(called).toBe(false);
    if (result.state === "failure") {
      expect(result.message).toContain("Only http and https");
    }
  });

  test("converts opener rejection to a safe failure message", async () => {
    const executor = new OsOpenUrlExecutor(() => {
      throw new Error("native stack detail");
    });

    const result = await executor.execute({ kind: "open_url", url: "https://example.com/" }, keyTarget);

    expect(result.state).toBe("failure");
    if (result.state === "failure") {
      expect(result.message).toBe("The operating system could not open the URL.");
      expect(result.message).not.toContain("native stack detail");
    }
  });

  test("converts opener false return to a user-facing failure", async () => {
    const executor = new OsOpenUrlExecutor(() => false);

    const result = await executor.execute({ kind: "open_url", url: "https://example.com/" }, keyTarget);

    expect(result.state).toBe("failure");
    if (result.state === "failure") {
      expect(result.message).toBe("The operating system did not accept the URL.");
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
