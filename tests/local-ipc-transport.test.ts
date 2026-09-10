import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCoreEndpoint } from "../src/infrastructure/main/core-endpoint";
import { LocalIpcCoreAdapter } from "../src/infrastructure/main/local-ipc-core-adapter";
import { type ClientEnvelope, type ServerMessage, keyroProtocolVersion } from "../src/infrastructure/main/core-protocol";

function reply(envelope: ClientEnvelope): ServerMessage {
  if (envelope.message.type === "handshake") {
    return { type: "handshake_accepted", request_id: envelope.request_id, core_version: "0.3.0", protocol: keyroProtocolVersion };
  }
  return {
    type: "snapshot", request_id: envelope.request_id,
    layout: { page_count: 4, key_rows: 3, key_columns: 4, encoder_count: 2 },
    profiles: [{ id: "p1", name: "Core Profile", is_active: true }], assignments: []
  };
}

class DelayedSocket extends EventEmitter {
  destroyed = false;
  setEncoding() { return this; }
  destroy() { this.destroyed = true; return this; }
  write(data: string, callback?: (error?: Error) => void) {
    const envelope = JSON.parse(data) as ClientEnvelope;
    queueMicrotask(() => this.emit("data", `${JSON.stringify(reply(envelope))}\n`));
    callback?.();
    return true;
  }
}

describe("Core IPC transport", () => {
  test("resolves the Windows pipe independently of home and preserves other platform defaults", () => {
    expect(defaultCoreEndpoint("win32", "")).toBe(String.raw`\\.\pipe\keyro-core-dev`);
    expect(defaultCoreEndpoint("darwin", "/Users/test")).toBe(join("/Users/test", "Library", "Application Support", "Keyro", "Core", "keyro-core-dev.sock"));
    expect(defaultCoreEndpoint("linux", "/home/test")).toBe(join("/home/test", ".local", "share", "keyro", "core", "keyro-core-dev.sock"));
  });

  test("keeps the explicit Windows pipe override and ignores old socket events after reconnect", async () => {
    const sockets: DelayedSocket[] = [];
    const endpoints: string[] = [];
    const endpoint = String.raw`\\.\pipe\keyro-test-override`;
    const adapter = new LocalIpcCoreAdapter({ socketPath: endpoint, connect: (path) => {
      endpoints.push(path);
      const socket = new DelayedSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    } });
    try {
      expect((await adapter.getSnapshot()).ok).toBe(true);
      const old = sockets[0]!;
      old.emit("data", '{"partial":');
      expect((await adapter.simulateReconnect()).state).toBe("connected");
      old.emit("close");
      old.emit("error", new Error("Late pipe error"));
      old.emit("data", "invalid old data\n");
      expect((await adapter.getSnapshot()).ok).toBe(true);
      expect((await adapter.getConnectionStatus()).state).toBe("connected");
      expect(sockets).toHaveLength(2);
      expect(endpoints).toEqual([endpoint, endpoint]);
    } finally {
      await adapter.close();
    }
  });

  test("settles a disconnected connection attempt before its connect event arrives", async () => {
    const sockets: DelayedSocket[] = [];
    const adapter = new LocalIpcCoreAdapter({ connect: () => {
      const socket = new DelayedSocket();
      sockets.push(socket);
      return socket;
    } });
    const pending = adapter.getSnapshot();
    await adapter.simulateDisconnect();
    expect((await pending).ok).toBe(false);
    const next = adapter.getSnapshot();
    sockets[0]!.emit("connect");
    sockets[0]!.emit("close");
    sockets[1]!.emit("connect");
    expect((await next).ok).toBe(true);
    await adapter.close();
  });

  test("returns a retryable error status when reconnecting to an unavailable Core", async () => {
    const adapter = new LocalIpcCoreAdapter({ connect: () => {
      const socket = new DelayedSocket();
      queueMicrotask(() => socket.emit("error", new Error("Core is not running")));
      return socket;
    } });
    try {
      expect((await adapter.simulateReconnect()).state).toBe("error");
      expect((await adapter.simulateReconnect()).state).toBe("error");
    } finally {
      await adapter.close();
    }
  });

  test("exchanges protocol frames and reconnects over the native OS transport", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keyro-ipc-"));
    const endpoint = process.platform === "win32"
      ? String.raw`\\.\pipe\keyro-studio-test-${process.pid}-${crypto.randomUUID()}`
      : join(directory, "core.sock");
    const sockets = new Set<Socket>();
    const received: string[] = [];
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const envelope = JSON.parse(buffer.slice(0, newline)) as ClientEnvelope;
          buffer = buffer.slice(newline + 1);
          received.push(envelope.message.type);
          const response = `${JSON.stringify(reply(envelope))}\n`;
          socket.write(response.slice(0, 7));
          socket.write(response.slice(7));
        }
      });
    });
    const adapter = new LocalIpcCoreAdapter({ socketPath: endpoint, requestTimeoutMs: 2000 });
    let snapshotEvents = 0;
    adapter.subscribe((event) => { if (event.type === "snapshot") snapshotEvents += 1; });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, resolve);
      });
      const snapshot = await adapter.getSnapshot();
      expect(snapshot.ok).toBe(true);
      if (snapshot.ok) {
        expect(snapshot.value.layout).toEqual({ pageCount: 4, keyRows: 3, keyColumns: 4, encoderCount: 2 });
        expect(snapshot.value.profiles[0]?.name).toBe("Core Profile");
      }
      expect((await adapter.simulateReconnect()).state).toBe("connected");
      expect(snapshotEvents).toBe(2);
      expect((await adapter.getSnapshot()).ok).toBe(true);
      expect(received).toEqual(["handshake", "get_snapshot", "handshake", "get_snapshot", "get_snapshot"]);
    } finally {
      await adapter.close();
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
