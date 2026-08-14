import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
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
  keyroProtocolVersion,
  type ClientEnvelope,
  type ServerMessage
} from "../src/infrastructure/main/core-protocol";
import { MockActionExecutor } from "../src/infrastructure/main/mock-action-executor";
import { MockCoreAdapter } from "../src/infrastructure/main/mock-core-adapter";
import { LocalIpcCoreAdapter } from "../src/infrastructure/main/local-ipc-core-adapter";
import { OsOpenUrlExecutor } from "../src/infrastructure/main/os-open-url-executor";
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

  test("creates local-ipc adapter for Core connections", async () => {
    const config = readCoreAdapterConfig({
      KEYRO_STUDIO_CORE_MODE: "local-ipc",
      KEYRO_STUDIO_CORE_SOCKET: "memory://missing-core"
    });
    const service = new StudioService(
      createCoreAdapter(config, { localIpc: { connect: () => new FakeCoreSocket(() => undefined, "Core is offline.") } })
    );

    expect(config.mode).toBe("local-ipc");
    expect(config.socketPath).toBe("memory://missing-core");
    expect(config.actionExecutorMode).toBe("mock");
    expect((await service.getConnectionStatus()).state).toBe("disconnected");
    const result = await service.getSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Could not communicate with Keyro Core.");
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

});

describe("Core protocol package v0.3.0", () => {
  test("keeps versioned DTO helpers in the infrastructure boundary", () => {
    expect(KEYRO_PROTOCOL_VERSION).toBe("0.3.0");
    expect(keyroProtocolVersion).toEqual({ major: 0, minor: 3 });
    expect(handshakeEnvelope("request-1", "0.0.0")).toEqual({
      request_id: "request-1",
      message: {
        type: "handshake",
        component: "studio",
        component_version: "0.0.0",
        protocol: { major: 0, minor: 3 }
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
      protocol: { major: 0, minor: 3 }
    });

    const snapshot = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-snapshot", { type: "get_snapshot" }),
      {
        coreVersion: "core-mock"
      }
    );

    expect(snapshot).toMatchObject({
      type: "snapshot",
      request_id: "request-snapshot",
      layout: { page_count: 4, key_rows: 3, key_columns: 4, encoder_count: 2 },
      profiles: [{ id: "profile-default", name: "Default", is_active: true }]
    });
    expect(snapshot.type === "snapshot" ? snapshot.assignments : []).toEqual([]);

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

    const response = await handleCoreProtocolInput(
      service,
      {
        request_id: "request-bad-handshake",
        message: {
          type: "handshake",
          component: "studio",
          component_version: "0.0.0",
          protocol: { major: 1, minor: 0 }
        }
      },
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

  test("rejects same-major minor-skew protocol handshakes during v0", async () => {
    const service = new StudioService(new MockCoreAdapter());

    const response = await handleCoreProtocolInput(
      service,
      {
        request_id: "request-future-minor",
        message: {
          type: "handshake",
          component: "studio",
          component_version: "0.0.0",
          protocol: { major: 0, minor: 4 }
        }
      },
      {
        coreVersion: "core-mock"
      }
    );

    expect(response).toEqual({
      type: "error",
      request_id: "request-future-minor",
      error: {
        code: "incompatible_protocol",
        message: "Keyro Studio and Core protocol versions are incompatible."
      }
    });
  });

  test("decodes untrusted protocol input before dispatching it", async () => {
    const service = new StudioService(new MockCoreAdapter());

    await expect(
      handleCoreProtocolInput(
        service,
        {
          request_id: "request-wire-list",
          message: { type: "get_snapshot" }
        },
        { coreVersion: "core-mock" }
      )
    ).resolves.toMatchObject({
      type: "snapshot",
      request_id: "request-wire-list",
      profiles: [{ id: "profile-default", name: "Default", is_active: true }],
      assignments: []
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

  test("handles Core-owned profile mutations and assignment clearing", async () => {
    const service = new StudioService(new MockCoreAdapter());

    const created = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-create", { type: "create_profile", name: "  Work  " }),
      { coreVersion: "core-mock" }
    );
    expect(created).toMatchObject({
      type: "profile",
      request_id: "request-create",
      profile: { name: "Work", is_active: false }
    });
    const profileId = created.type === "profile" ? created.profile.id : "missing";

    const renamed = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-rename", { type: "rename_profile", profile_id: profileId, name: "Deep Work" }),
      { coreVersion: "core-mock" }
    );
    expect(renamed).toEqual({
      type: "profile",
      request_id: "request-rename",
      profile: { id: profileId, name: "Deep Work", is_active: false }
    });

    const saved = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-save-before-clear", {
        type: "save_assignment",
        assignment: {
          profile_id: profileId,
          control: { kind: "key", page: 0, key: 0 },
          action: { kind: "open_url", url: "https://example.com/" }
        }
      }),
      { coreVersion: "core-mock" }
    );
    expect(saved).toEqual({ type: "acknowledged", request_id: "request-save-before-clear" });

    const cleared = await handleCoreProtocolEnvelope(
      service,
      createClientEnvelope("request-clear", {
        type: "clear_assignment",
        profile_id: profileId,
        control: { kind: "key", page: 0, key: 0 }
      }),
      { coreVersion: "core-mock" }
    );
    expect(cleared).toEqual({ type: "acknowledged", request_id: "request-clear" });

    const snapshot = await service.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.profiles.find((profile) => profile.id === profileId)?.pages[0]?.keys[0]?.action).toBeNull();
    }
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

describe("local IPC Core adapter", () => {
  test("handshakes, reads snapshots, saves assignments, activates profiles, and maps action events from Core", async () => {
    let activeProfileId = "profile-core";
    const profiles = [
      { id: "profile-core", name: "  Core Default  ", is_active: true },
      { id: "profile-second", name: "Second", is_active: false }
    ];
    const assignments: Array<{
      profile_id: string;
      control: { kind: "key"; page: number; key: number } | { kind: "encoder"; page: number; encoder: number; operation: "left" | "right" | "press" };
      action: { kind: "open_url"; url: string };
    }> = [
      {
        profile_id: "profile-core",
        control: { kind: "encoder", page: 0, encoder: 0, operation: "left" },
        action: { kind: "open_url", url: "https://example.com/left" }
      }
    ];
    const server = await createFakeCoreServer(async (envelope, socket) => {
      if (envelope.message.type === "handshake") {
        writeServerMessage(socket, {
          type: "handshake_accepted",
          request_id: envelope.request_id,
          core_version: "0.3.0",
          protocol: keyroProtocolVersion
        });
        return;
      }
      if (envelope.message.type === "get_snapshot") {
        writeServerMessage(socket, {
          type: "snapshot",
          request_id: envelope.request_id,
          layout: { page_count: 2, key_rows: 2, key_columns: 3, encoder_count: 1 },
          profiles: profiles.map((profile) => ({ ...profile, is_active: activeProfileId === profile.id })),
          assignments: assignments.map((assignment) => ({
            profile_id: assignment.profile_id,
            control: assignment.control,
            actions: [assignment.action]
          }))
        });
        return;
      }
      if (envelope.message.type === "create_profile") {
        const profile = { id: "profile-created", name: envelope.message.name, is_active: false };
        profiles.push(profile);
        writeServerMessage(socket, {
          type: "profile",
          request_id: envelope.request_id,
          profile
        });
        return;
      }
      if (envelope.message.type === "rename_profile") {
        const message = envelope.message;
        const profile = profiles.find((candidate) => candidate.id === message.profile_id);
        if (!profile) {
          writeServerMessage(socket, {
            type: "error",
            request_id: envelope.request_id,
            error: { code: "not_found", message: "Profile was not found." }
          });
          return;
        }
        profile.name = message.name;
        writeServerMessage(socket, {
          type: "profile",
          request_id: envelope.request_id,
          profile: { ...profile, is_active: activeProfileId === profile.id }
        });
        return;
      }
      if (envelope.message.type === "set_active_profile") {
        activeProfileId = envelope.message.profile_id;
        writeServerMessage(socket, {
          type: "acknowledged",
          request_id: envelope.request_id
        });
        return;
      }
      if (envelope.message.type === "save_assignment") {
        assignments.push(envelope.message.assignment);
        writeServerMessage(socket, {
          type: "acknowledged",
          request_id: envelope.request_id
        });
        return;
      }
      if (envelope.message.type === "clear_assignment") {
        const message = envelope.message;
        const index = assignments.findIndex(
          (assignment) =>
            assignment.profile_id === message.profile_id &&
            JSON.stringify(assignment.control) === JSON.stringify(message.control)
        );
        if (index >= 0) assignments.splice(index, 1);
        writeServerMessage(socket, {
          type: "acknowledged",
          request_id: envelope.request_id
        });
        return;
      }
      if (envelope.message.type === "virtual_control_input") {
        writeServerMessage(socket, {
          type: "action_event",
          event: {
            state: "running",
            execution_id: "execution-1",
            profile_id: "profile-core",
            control: envelope.message.control
          }
        });
        writeServerMessage(socket, {
          type: "action_event",
          event: {
            state: "succeeded",
            execution_id: "execution-1"
          }
        });
        writeServerMessage(socket, {
          type: "acknowledged",
          request_id: envelope.request_id
        });
      }
    });
    const adapter = new LocalIpcCoreAdapter({ socketPath: server.socketPath, connect: server.connect });
    const events: unknown[] = [];
    adapter.subscribe((event) => events.push(event));

    const snapshot = await adapter.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.layout).toEqual({ pageCount: 2, keyRows: 2, keyColumns: 3, encoderCount: 1 });
      expect(snapshot.value.profiles[0]?.name).toBe("  Core Default  ");
      expect(snapshot.value.profiles[0]?.pages[0]?.encoders[0]?.rotateLeft).toEqual({
        kind: "open_url",
        url: "https://example.com/left"
      });
    }

    const created = await adapter.createProfile("  Work  ");
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.name).toBe("  Work  ");
      expect(created.value.active).toBe(false);
    }

    const renamed = await adapter.renameProfile("profile-created", "Deep Work");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.name).toBe("Deep Work");
    }

    const activated = await adapter.activateProfile("profile-second");
    expect(activated.ok).toBe(true);
    if (activated.ok) {
      expect(activated.value.activeProfileId).toBe("profile-second");
    }

    const page = structuredClone(snapshot.ok ? snapshot.value.profiles[0]?.pages[0] : null);
    expect(page).not.toBeNull();
    if (page) {
      page.keys[0]!.action = { kind: "open_url", url: "https://example.com/" };
      const saved = await adapter.savePage("profile-core", page);
      expect(saved.ok).toBe(true);

      const clearedPage = structuredClone(page);
      clearedPage.keys[0]!.action = null;
      const cleared = await adapter.savePage("profile-core", clearedPage);
      expect(cleared.ok).toBe(true);
      if (cleared.ok) {
        expect(cleared.value.profiles[0]?.pages[0]?.keys[0]?.action).toBeNull();
      }

      const idempotentClear = await adapter.savePage("profile-core", clearedPage);
      expect(idempotentClear.ok).toBe(true);

      const multiChangePage = structuredClone(page);
      multiChangePage.keys[1]!.action = { kind: "open_url", url: "https://example.com/second" };
      multiChangePage.keys[2]!.action = { kind: "open_url", url: "https://example.com/third" };
      const multiChange = await adapter.savePage("profile-core", multiChangePage);
      expect(multiChange.ok).toBe(false);
      if (!multiChange.ok) expect(multiChange.error.code).toBe("unsupported_operation");
    }
    expect(assignments).toContainEqual({
      profile_id: "profile-core",
      control: { kind: "encoder", page: 0, encoder: 0, operation: "left" },
      action: { kind: "open_url", url: "https://example.com/left" }
    });
    expect(assignments).toHaveLength(1);

    const result = await adapter.sendVirtualInput({
      type: "key",
      profileId: "profile-core",
      pageIndex: 0,
      keyIndex: 0
    });

    expect(result.ok).toBe(true);
    expect(events).toContainEqual({
      type: "action",
      status: {
        state: "running",
        target: {
          type: "key",
          profileId: "profile-core",
          pageIndex: 0,
          keyIndex: 0
        }
      }
    });
    expect(events).toContainEqual({
      type: "action",
      status: {
        state: "success",
        target: {
          type: "key",
          profileId: "profile-core",
          pageIndex: 0,
          keyIndex: 0
        },
        message: "Action completed."
      }
    });

    await adapter.close();
    await server.close();
  });

  test("rejects malformed and unexpected profile mutation responses from Core", async () => {
    const unexpectedServer = await createFakeCoreServer((envelope, socket) => {
      if (envelope.message.type === "handshake") {
        writeServerMessage(socket, {
          type: "handshake_accepted",
          request_id: envelope.request_id,
          core_version: "0.3.0",
          protocol: keyroProtocolVersion
        });
        return;
      }
      if (envelope.message.type === "create_profile") {
        writeServerMessage(socket, { type: "acknowledged", request_id: envelope.request_id });
      }
    });
    const unexpectedAdapter = new LocalIpcCoreAdapter({
      socketPath: unexpectedServer.socketPath,
      connect: unexpectedServer.connect
    });

    const unexpected = await unexpectedAdapter.createProfile("Work");
    expect(unexpected.ok).toBe(false);
    if (!unexpected.ok) expect(unexpected.error.code).toBe("core_unavailable");
    await unexpectedAdapter.close();
    await unexpectedServer.close();

    const malformedServer = await createFakeCoreServer((envelope, socket) => {
      if (envelope.message.type === "handshake") {
        writeServerMessage(socket, {
          type: "handshake_accepted",
          request_id: envelope.request_id,
          core_version: "0.3.0",
          protocol: keyroProtocolVersion
        });
        return;
      }
      if (envelope.message.type === "create_profile") {
        socket.receiveRaw(
          `${JSON.stringify({
            type: "profile",
            request_id: envelope.request_id,
            profile: { id: 1, name: "Work", is_active: false }
          })}\n`
        );
      }
    });
    const malformedAdapter = new LocalIpcCoreAdapter({
      socketPath: malformedServer.socketPath,
      connect: malformedServer.connect
    });

    const malformed = await malformedAdapter.createProfile("Work");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.message).toContain("Could not communicate with Keyro Core.");
    await malformedAdapter.close();
    await malformedServer.close();
  });

  test("maps Core not_found profile mutation responses to validation errors", async () => {
    const server = await createFakeCoreServer((envelope, socket) => {
      if (envelope.message.type === "handshake") {
        writeServerMessage(socket, {
          type: "handshake_accepted",
          request_id: envelope.request_id,
          core_version: "0.3.0",
          protocol: keyroProtocolVersion
        });
        return;
      }
      if (envelope.message.type === "rename_profile") {
        writeServerMessage(socket, {
          type: "error",
          request_id: envelope.request_id,
          error: { code: "not_found", message: "Profile was not found." }
        });
      }
    });
    const adapter = new LocalIpcCoreAdapter({ socketPath: server.socketPath, connect: server.connect });

    const result = await adapter.renameProfile("missing", "Renamed");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.message).toBe("Profile was not found.");
    }
    await adapter.close();
    await server.close();
  });

  test("rejects incompatible handshakes from Core", async () => {
    const server = await createFakeCoreServer((envelope, socket) => {
      if (envelope.message.type === "handshake") {
        socket.receiveRaw(
          `${JSON.stringify({
            type: "handshake_accepted",
            request_id: envelope.request_id,
            core_version: "0.1.0",
            protocol: { major: 0, minor: 1 }
          })}\n`
        );
      }
    });
    const adapter = new LocalIpcCoreAdapter({ socketPath: server.socketPath, connect: server.connect });

    const result = await adapter.getSnapshot();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Could not communicate with Keyro Core.");
    await adapter.close();
    await server.close();
  });

  test("fails pending requests when Core sends malformed messages", async () => {
    const server = await createFakeCoreServer((envelope, socket) => {
      if (envelope.message.type === "handshake") {
        writeServerMessage(socket, {
          type: "handshake_accepted",
          request_id: envelope.request_id,
          core_version: "0.3.0",
          protocol: keyroProtocolVersion
        });
        return;
      }
      if (envelope.message.type === "get_snapshot") {
        socket.receiveRaw(
          `${JSON.stringify({
            type: "snapshot",
            request_id: envelope.request_id,
            layout: { page_count: 1, key_rows: 1, key_columns: 1, encoder_count: 1 },
            profiles: [{ id: 1 }],
            assignments: []
          })}\n`
        );
      }
    });
    const adapter = new LocalIpcCoreAdapter({ socketPath: server.socketPath, connect: server.connect });

    const result = await adapter.getSnapshot();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Could not communicate with Keyro Core.");
    await adapter.close();
    await server.close();
  });

  test("rejects Core snapshots with multi-action assignments until Studio can preserve them", async () => {
    const server = await createFakeCoreServer((envelope, socket) => {
      if (envelope.message.type === "handshake") {
        writeServerMessage(socket, {
          type: "handshake_accepted",
          request_id: envelope.request_id,
          core_version: "0.3.0",
          protocol: keyroProtocolVersion
        });
        return;
      }
      if (envelope.message.type === "get_snapshot") {
        writeServerMessage(socket, {
          type: "snapshot",
          request_id: envelope.request_id,
          layout: { page_count: 1, key_rows: 1, key_columns: 1, encoder_count: 1 },
          profiles: [{ id: "profile-core", name: "Core Default", is_active: true }],
          assignments: [
            {
              profile_id: "profile-core",
              control: { kind: "key", page: 0, key: 0 },
              actions: [
                { kind: "open_url", url: "https://example.com/first" },
                { kind: "open_url", url: "https://example.com/second" }
              ]
            }
          ]
        });
      }
    });
    const adapter = new LocalIpcCoreAdapter({ socketPath: server.socketPath, connect: server.connect });

    const result = await adapter.getSnapshot();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported_operation");
      expect(result.error.message).toContain("multiple actions");
    }
    await adapter.close();
    await server.close();
  });

  test("times out unanswered Core requests", async () => {
    const server = await createFakeCoreServer(() => undefined);
    const adapter = new LocalIpcCoreAdapter({
      socketPath: server.socketPath,
      connect: server.connect,
      requestTimeoutMs: 1
    });

    const result = await adapter.getSnapshot();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain("timed out");
    await adapter.close();
    await server.close();
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

async function createFakeCoreServer(
  handler: (envelope: ClientEnvelope, socket: FakeCoreSocket) => void | Promise<void>
): Promise<{ socketPath: string; connect: () => FakeCoreSocket; close: () => Promise<void> }> {
  const socketPath = "memory://keyro-core";
  return {
    socketPath,
    connect: () => new FakeCoreSocket(handler),
    close: async () => undefined
  };
}

function writeServerMessage(socket: FakeCoreSocket, message: ServerMessage): void {
  socket.receiveFromServer(message);
}

class FakeCoreSocket extends EventEmitter {
  destroyed = false;
  private buffer = "";

  constructor(
    private readonly handler: (envelope: ClientEnvelope, socket: FakeCoreSocket) => void | Promise<void>,
    private readonly connectionError?: string
  ) {
    super();
    queueMicrotask(() => {
      if (this.connectionError) {
        this.emit("error", new Error(this.connectionError));
        this.destroy();
        return;
      }
      this.emit("connect");
    });
  }

  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }

  write(data: string, callback?: (error?: Error) => void): boolean {
    this.buffer += data;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      void this.handler(JSON.parse(line) as ClientEnvelope, this);
    }
    callback?.();
    return true;
  }

  receiveFromServer(message: ServerMessage): void {
    this.emit("data", `${JSON.stringify(message)}\n`);
  }

  receiveRaw(data: string): void {
    this.emit("data", data);
  }

  destroy(): this {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit("close");
    }
    return this;
  }
}
