import { describe, expect, test } from "bun:test";
import { createOpenUrlAction } from "../src/domain/action";
import type { ActionExecutorPort } from "../src/application/ports/action-executor-port";
import { MockCoreAdapter } from "../src/infrastructure/main/mock-core-adapter";
import { StudioService } from "../src/application/studio-service";

describe("studio service with mock core", () => {
  test("supports profile lifecycle", async () => {
    const service = new StudioService(new MockCoreAdapter());
    const created = await service.createProfile("Work");
    expect(created.ok).toBe(true);

    const snapshot = await service.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    const work = snapshot.value.profiles.find((profile) => profile.name === "Work");
    expect(work).toBeDefined();

    const renamed = await service.renameProfile(work!.id, "Deep Work");
    expect(renamed.ok).toBe(true);

    const activated = await service.activateProfile(work!.id);
    expect(activated.ok).toBe(true);
    if (activated.ok) expect(activated.value.activeProfileId).toBe(work!.id);
  });

  test("saves and reloads all default pages and keys", async () => {
    const service = new StudioService(new MockCoreAdapter());
    const snapshot = await service.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    const profile = snapshot.value.profiles[0]!;
    const page = structuredClone(profile.pages[2]!);
    const action = createOpenUrlAction("https://example.com/page-3-key-1");
    expect(action.ok).toBe(true);
    if (!action.ok) return;
    page.keys[0]!.action = action.value;

    const saved = await service.savePage(profile.id, page);
    expect(saved.ok).toBe(true);

    const reloaded = await service.getSnapshot();
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value.profiles[0]!.pages).toHaveLength(4);
      expect(reloaded.value.profiles[0]!.pages[2]!.keys).toHaveLength(12);
      expect(reloaded.value.profiles[0]!.pages[2]!.keys[0]!.action?.url).toBe("https://example.com/page-3-key-1");
    }
  });

  test("handles variable layouts", async () => {
    const service = new StudioService(
      new MockCoreAdapter({ layout: { pageCount: 3, keyRows: 2, keyColumns: 2, encoderCount: 3 } })
    );
    const snapshot = await service.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    expect(snapshot.value.layout.pageCount).toBe(3);
    expect(snapshot.value.profiles[0]!.pages[0]!.keys).toHaveLength(4);
    expect(snapshot.value.profiles[0]!.pages[0]!.encoders).toHaveLength(3);
  });

  test("does not claim saved state while disconnected", async () => {
    const service = new StudioService(new MockCoreAdapter());
    const snapshot = await service.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const profile = snapshot.value.profiles[0]!;

    await service.simulateDisconnect();
    const saved = await service.savePage(profile.id, profile.pages[0]!);
    expect(saved.ok).toBe(false);

    await service.simulateReconnect();
    const recovered = await service.getSnapshot();
    expect(recovered.ok).toBe(true);
  });

  test("reports open_url success and failure without stack traces", async () => {
    const service = new StudioService(new MockCoreAdapter());
    const snapshot = await service.getSnapshot();
    if (!snapshot.ok) throw new Error("snapshot failed");

    const profile = snapshot.value.profiles[0]!;
    const page = structuredClone(profile.pages[0]!);
    const good = createOpenUrlAction("https://example.com");
    const bad = createOpenUrlAction("https://fail.example.com");
    if (!good.ok || !bad.ok) throw new Error("action setup failed");
    page.keys[0]!.action = good.value;
    page.keys[1]!.action = bad.value;
    await service.savePage(profile.id, page);

    const success = await service.sendVirtualInput({ type: "key", profileId: profile.id, pageIndex: 0, keyIndex: 0 });
    const failure = await service.sendVirtualInput({ type: "key", profileId: profile.id, pageIndex: 0, keyIndex: 1 });

    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(true);
    if (success.ok) expect(success.value.state).toBe("success");
    if (failure.ok) {
      expect(failure.value.state).toBe("failure");
      if (failure.value.state === "failure") {
        expect(failure.value.message.includes("Error:")).toBe(false);
      }
    }
  });

  test("delegates assigned virtual inputs to the action executor", async () => {
    const calls: Array<{ url: string; target: string }> = [];
    const executor: ActionExecutorPort = {
      execute: async (action, target) => {
        calls.push({ url: action.url, target });
        return { state: "success", target, message: "delegated" };
      }
    };
    const service = new StudioService(new MockCoreAdapter({ actionExecutor: executor }));
    const snapshot = await service.getSnapshot();
    if (!snapshot.ok) throw new Error("snapshot failed");

    const profile = snapshot.value.profiles[0]!;
    const page = structuredClone(profile.pages[0]!);
    const action = createOpenUrlAction("https://example.com/delegated");
    if (!action.ok) throw new Error("action setup failed");
    page.keys[0]!.action = action.value;
    await service.savePage(profile.id, page);

    const result = await service.sendVirtualInput({ type: "key", profileId: profile.id, pageIndex: 0, keyIndex: 0 });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ url: "https://example.com/delegated", target: "Page 1 Key 1" }]);
  });

  test("does not invoke the action executor for unassigned controls", async () => {
    let callCount = 0;
    const executor: ActionExecutorPort = {
      execute: async (_action, target) => {
        callCount += 1;
        return { state: "success", target, message: "unexpected" };
      }
    };
    const service = new StudioService(new MockCoreAdapter({ actionExecutor: executor }));
    const snapshot = await service.getSnapshot();
    if (!snapshot.ok) throw new Error("snapshot failed");
    const profile = snapshot.value.profiles[0]!;

    const result = await service.sendVirtualInput({ type: "key", profileId: profile.id, pageIndex: 0, keyIndex: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("failure");
    expect(callCount).toBe(0);
  });
});
