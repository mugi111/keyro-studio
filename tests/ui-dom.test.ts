import { describe, expect, test } from "bun:test";
import type { PageConfig, StudioSnapshot } from "../src/domain/profile";
import { createEmptyProfile } from "../src/domain/profile";
import type { ActionExecutionStatus, ActionExecutionTarget } from "../src/application/ports/action-executor-port";
import type { ConnectionStatus, CoreEvent } from "../src/application/ports/core-port";
import { mountStudio, type StudioAPI } from "../src/ui/dom";
import { err, ok, type Result } from "../src/shared/result";
import { flushMicrotasks, TestDomElement, TestDomRoot } from "./helpers/test-dom";

class FakeStudioApi implements StudioAPI {
  readonly savedPages: PageConfig[] = [];
  readonly createdProfiles: string[] = [];
  readonly renamedProfiles: Array<{ profileId: string; name: string }> = [];
  readonly activatedProfiles: string[] = [];
  readonly virtualInputs: Array<Parameters<StudioAPI["sendVirtualInput"]>[0]> = [];
  readyCalls = 0;
  private nextProfileNumber: number;
  private listener: ((event: CoreEvent) => void) | null = null;

  constructor(private snapshot: StudioSnapshot) {
    this.nextProfileNumber = snapshot.profiles.length + 1;
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return { state: "connected" };
  }

  async getSnapshot(): Promise<Result<StudioSnapshot>> {
    return ok(structuredClone(this.snapshot));
  }

  async createProfile(name: string): Promise<Result<StudioSnapshot>> {
    this.createdProfiles.push(name);
    const profile = createEmptyProfile(`profile-${this.nextProfileNumber++}`, name, this.snapshot.layout);
    this.snapshot = {
      ...this.snapshot,
      profiles: [...this.snapshot.profiles, profile]
    };
    return ok(structuredClone(this.snapshot));
  }

  async renameProfile(profileId: string, name: string): Promise<Result<StudioSnapshot>> {
    this.renamedProfiles.push({ profileId, name });
    this.snapshot = {
      ...this.snapshot,
      profiles: this.snapshot.profiles.map((profile) => (profile.id === profileId ? { ...profile, name } : profile))
    };
    return ok(structuredClone(this.snapshot));
  }

  async activateProfile(profileId: string): Promise<Result<StudioSnapshot>> {
    this.activatedProfiles.push(profileId);
    this.snapshot = {
      ...this.snapshot,
      activeProfileId: profileId,
      profiles: this.snapshot.profiles.map((profile) => ({ ...profile, active: profile.id === profileId }))
    };
    return ok(structuredClone(this.snapshot));
  }

  async savePage(profileId: string, page: PageConfig): Promise<Result<StudioSnapshot>> {
    this.savedPages.push(structuredClone(page));
    const profile = this.snapshot.profiles.find((item) => item.id === profileId)!;
    profile.pages[page.index] = structuredClone(page);
    return ok(structuredClone(this.snapshot));
  }

  async sendVirtualInput(input: Parameters<StudioAPI["sendVirtualInput"]>[0]): Promise<Result<ActionExecutionStatus>> {
    this.virtualInputs.push(input);
    const action = this.resolveAction(input);
    const target = actionTargetFromInput(input);
    const status: ActionExecutionStatus = action?.url.includes("fail")
      ? { state: "failure", target, code: "open_url_failed", message: "Action failed." }
      : { state: "success", target, message: "Opened URL." };
    this.emit({ type: "action", status });
    return ok(status);
  }

  async simulateDisconnect(): Promise<ConnectionStatus> {
    const status: ConnectionStatus = { state: "disconnected", reason: "Test disconnect" };
    this.emit({ type: "connection", status });
    return status;
  }

  async simulateReconnect(): Promise<ConnectionStatus> {
    const reconnecting: ConnectionStatus = { state: "reconnecting", reason: "Test reconnect" };
    this.emit({ type: "connection", status: reconnecting });
    const connected: ConnectionStatus = { state: "connected" };
    this.emit({ type: "connection", status: connected });
    return connected;
  }

  onCoreEvent(listener: (event: CoreEvent) => void): void {
    this.listener = listener;
  }

  ready(): void {
    this.readyCalls += 1;
  }

  emit(event: CoreEvent): void {
    this.listener?.(event);
  }

  private resolveAction(input: Parameters<StudioAPI["sendVirtualInput"]>[0]) {
    const profile = this.snapshot.profiles.find((item) => item.id === input.profileId);
    const page = profile?.pages[input.pageIndex];
    if (input.type === "key") return page?.keys[input.keyIndex]?.action;
    return page?.encoders[input.encoderIndex]?.[input.interaction] ?? null;
  }
}

describe("DOM UI integration", () => {
  test("mounts and hydrates a variable device layout through the typed StudioAPI", async () => {
    const layout = { pageCount: 2, keyRows: 2, keyColumns: 3, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    expect(api.readyCalls).toBe(1);
    expect(root.innerHTML).toContain("2 pages");
    expect(root.innerHTML).toContain("3 x 2 keys");
    expect(root.querySelectorAll("[data-page]")).toHaveLength(2);
    expect(root.querySelectorAll("[data-key]")).toHaveLength(6);
    expect(root.querySelectorAll("[data-encoder-control]")).toHaveLength(3);
    expect(root.querySelector("[data-field='profile-name']")?.value).toBe("Default");
  });

  test("does not restore a stale connecting status after snapshot hydration connects", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const snapshot = { layout, profiles: [profile], activeProfileId: profile.id };
    const api = new FakeStudioApi(snapshot);
    const root = new TestDomRoot();
    let snapshotHydrated = false;

    api.getSnapshot = async () => {
      snapshotHydrated = true;
      api.emit({ type: "connection", status: { state: "connected" } });
      return ok(structuredClone(snapshot));
    };
    api.getConnectionStatus = async () => (snapshotHydrated ? { state: "connected" } : { state: "connecting" });

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    expect(root.innerHTML).toContain("connected");
    expect(root.innerHTML).not.toContain("Connecting");
    expect(root.querySelector("[data-field='profile-name']")?.value).toBe("Default");
  });

  test("disables Core mutation controls while the connection is not ready", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    api.getConnectionStatus = async () => ({ state: "connecting" });

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();
    await element(root, "[data-key='0']").click();

    expect(element(root, "[data-action='create-profile']").disabled).toBe(true);
    expect(element(root, "[data-field='profile-name']").disabled).toBe(true);
    expect(element(root, "[data-action='save-action']").disabled).toBe(true);
    expect(element(root, "[data-action='clear-action']").disabled).toBe(true);
    expect(element(root, "[data-action='simulate-input']").disabled).toBe(true);
  });

  test("renders state changes and wires key editing events to savePage", async () => {
    const layout = { pageCount: 2, keyRows: 1, keyColumns: 2, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    await element(root, "[data-page='1']").click();
    expect(element(root, "[data-page='1']").className).toContain("selected");

    await element(root, "[data-key='0']").click();
    expect(root.innerHTML.indexOf('class="action-editor"')).toBeLessThan(root.innerHTML.indexOf('class="device-area"'));
    const urlInput = element(root, "[data-field='action-url']");
    await urlInput.input("https://example.com/meeting");
    expect(root.innerHTML).toContain("Unsaved changes.");

    await element(root, "[data-action='save-action']").click();
    await flushMicrotasks();

    expect(api.savedPages).toHaveLength(1);
    expect(api.savedPages[0]?.index).toBe(1);
    expect(api.savedPages[0]?.keys[0]?.action).toEqual({ kind: "open_url", url: "https://example.com/meeting" });
    expect(root.innerHTML).toContain("Saved to Core.");

    api.emit({
      type: "action",
      status: {
        state: "success",
        target: { type: "key", profileId: profile.id, pageIndex: 1, keyIndex: 0 },
        message: "Opened URL."
      }
    });
    expect(root.innerHTML).toContain("Opened URL.");
  });

  test("sends virtual key input and renders action execution status", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    profile.pages[0]!.keys[0]!.action = { kind: "open_url", url: "https://example.com/" };
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    await element(root, "[data-key='0']").click();
    await element(root, "[data-action='simulate-input']").click();
    await flushMicrotasks();

    expect(api.virtualInputs).toEqual([{ type: "key", profileId: profile.id, pageIndex: 0, keyIndex: 0 }]);
    expect(root.innerHTML).toContain("Page 1 Key 1: Opened URL.");
    expect(root.innerHTML).toContain("target-success");
  });

  test("renders request failures without an action event and keeps acknowledgements pending", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();
    api.sendVirtualInput = async (input) => ok({ state: "failure", target: actionTargetFromInput(input), code: "internal", message: "Core request failed." });
    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();
    await element(root, "[data-key='0']").click();
    await element(root, "[data-action='simulate-input']").click();
    expect(root.innerHTML).toContain("Core request failed.");
    expect(element(root, "[data-action='simulate-input']").disabled).toBe(false);

    api.sendVirtualInput = async (input) => ok({ state: "success", target: actionTargetFromInput(input), message: "Action request completed." });
    await element(root, "[data-action='simulate-input']").click();
    expect(element(root, "[data-action='simulate-input']").disabled).toBe(true);
    expect(root.innerHTML).not.toContain("Action request completed.");
    await element(root, "[data-action='disconnect']").click();
    expect(root.innerHTML).toContain("Core disconnected before action completion was confirmed.");
    await element(root, "[data-action='reconnect']").click();
    expect(element(root, "[data-action='simulate-input']").disabled).toBe(false);
  });

  test("renders virtual input failures on the target control", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    profile.pages[0]!.keys[0]!.action = { kind: "open_url", url: "https://fail.example.com/" };
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    await element(root, "[data-key='0']").click();
    await element(root, "[data-action='simulate-input']").click();
    await flushMicrotasks();

    expect(api.virtualInputs).toEqual([{ type: "key", profileId: profile.id, pageIndex: 0, keyIndex: 0 }]);
    expect(root.innerHTML).toContain("Page 1 Key 1: Action failed.");
    expect(root.innerHTML).toContain("target-failure");
  });

  test("sends virtual encoder input and renders reconnect state transitions", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    profile.pages[0]!.encoders[0]!.rotateRight = { kind: "open_url", url: "https://example.com/encoder" };
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    await element(root, "[data-encoder-control='rotateRight']").click();
    await element(root, "[data-action='simulate-input']").click();
    await flushMicrotasks();

    expect(api.virtualInputs).toEqual([
      { type: "encoder", profileId: profile.id, pageIndex: 0, encoderIndex: 0, interaction: "rotateRight" }
    ]);
    expect(root.innerHTML).toContain("Page 1 Encoder 1 rotateRight: Opened URL.");

    await element(root, "[data-action='disconnect']").click();
    expect(root.innerHTML).toContain("disconnected: Test disconnect");
    expect(root.innerHTML).toContain("Disconnected. Edits cannot be saved until Core reconnects.");

    api.emit({ type: "connection", status: { state: "reconnecting", reason: "Manual reconnect check" } });
    expect(root.innerHTML).toContain("reconnecting: Manual reconnect check");

    api.emit({ type: "connection", status: { state: "connected" } });
    expect(root.innerHTML).toContain("connected");
  });

  test("creates profiles with normalized names and rejects blank prompts before RPC", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();
    const restorePrompt = stubPrompt(["  Focus   Mode  ", null, "   "]);

    try {
      mountStudio(root as unknown as HTMLElement, api);
      await flushMicrotasks();

      await element(root, "[data-action='create-profile']").click();
      expect(api.createdProfiles).toEqual(["Focus Mode"]);
      expect(root.innerHTML).toContain("Focus Mode");
      expect(root.innerHTML).toContain("Profile created.");

      await element(root, "[data-action='create-profile']").click();
      expect(api.createdProfiles).toEqual(["Focus Mode"]);
      expect(root.innerHTML).not.toContain("Profile name is required.");

      await element(root, "[data-action='create-profile']").click();
      expect(api.createdProfiles).toEqual(["Focus Mode"]);
      expect(root.innerHTML).toContain("Profile name is required.");
    } finally {
      restorePrompt();
    }
  });

  test("skips unchanged profile renames and normalizes changed names before RPC", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("profile-1", "Default", layout, true);
    const api = new FakeStudioApi({ layout, profiles: [profile], activeProfileId: profile.id });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    await element(root, "[data-field='profile-name']").change(" Default ");
    expect(api.renamedProfiles).toEqual([]);
    expect(root.innerHTML).toContain("Profile name unchanged.");

    await element(root, "[data-field='profile-name']").change("   ");
    expect(api.renamedProfiles).toEqual([]);
    expect(root.innerHTML).toContain("Profile name is required.");

    await element(root, "[data-field='profile-name']").change(" Deep   Work ");
    expect(api.renamedProfiles).toEqual([{ profileId: profile.id, name: "Deep Work" }]);
    expect(root.querySelector("[data-field='profile-name']")?.value).toBe("Deep Work");
    expect(root.innerHTML).toContain("Profile renamed.");
  });

  test("activates a profile from the profile list", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const defaultProfile = createEmptyProfile("profile-1", "Default", layout, true);
    const secondProfile = createEmptyProfile("profile-2", "Second", layout);
    const api = new FakeStudioApi({
      layout,
      profiles: [defaultProfile, secondProfile],
      activeProfileId: defaultProfile.id
    });
    const root = new TestDomRoot();

    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();

    await element(root, "[data-profile='profile-2']").click();

    expect(api.activatedProfiles).toEqual(["profile-2"]);
    expect(root.innerHTML).toContain("Profile activated.");
    expect(element(root, "[data-profile='profile-2']").className).toBe("selected");
    expect(element(root, "[data-field='profile-name']").value).toBe("Second");
    await element(root, "[data-field='profile-name']").change("Updated Second");
    expect(api.renamedProfiles).toEqual([{ profileId: secondProfile.id, name: "Updated Second" }]);
  });

  test("switches editor assignments only after activation succeeds and drops the old draft", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const first = createEmptyProfile("profile-1", "First", layout, true);
    const second = createEmptyProfile("profile-2", "Second", layout);
    second.pages[0]!.keys[0]!.action = { kind: "open_url", url: "https://second.example/" };
    second.pages[0]!.encoders[0]!.press = { kind: "open_url", url: "https://encoder.example/" };
    const api = new FakeStudioApi({ layout, profiles: [first, second], activeProfileId: first.id });
    const root = new TestDomRoot();
    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();
    await element(root, "[data-key='0']").click();
    await element(root, "[data-field='action-url']").input("https://unsaved.example/");

    const activate = api.activateProfile.bind(api);
    let resolve!: (result: Result<StudioSnapshot>) => void;
    api.activateProfile = () => new Promise((done) => { resolve = done; });
    const pending = element(root, "[data-profile='profile-2']").click();
    expect(element(root, "[data-field='profile-name']").value).toBe("First");
    expect(element(root, "[data-action='save-action']").disabled).toBe(true);
    await element(root, "[data-action='save-action']").click();
    expect(api.savedPages).toHaveLength(0);
    const beforeActivation = await api.getSnapshot();
    if (!beforeActivation.ok) throw new Error("Expected snapshot");
    api.emit({ type: "snapshot", snapshot: beforeActivation.value });
    resolve(await activate(second.id));
    await pending;

    expect(root.querySelector("[data-field='action-url']")).toBeNull();
    expect(element(root, "[data-field='profile-name']").value).toBe("Second");
    await element(root, "[data-key='0']").click();
    expect(element(root, "[data-field='action-url']").value).toBe("https://second.example/");
    await element(root, "[data-action='simulate-input']").click();
    expect(api.virtualInputs[0]?.profileId).toBe(second.id);
    await element(root, "[data-field='action-url']").input("https://updated.example/");
    await element(root, "[data-action='save-action']").click();
    const saved = await api.getSnapshot();
    if (!saved.ok) throw new Error("Expected snapshot");
    expect(saved.value.profiles[0]!.pages[0]!.keys[0]!.action).toBeNull();
    expect(saved.value.profiles[1]!.pages[0]!.keys[0]!.action?.url).toBe("https://updated.example/");
    await element(root, "[data-encoder-control='press']").click();
    expect(element(root, "[data-field='action-url']").value).toBe("https://encoder.example/");
    await element(root, "[data-action='clear-action']").click();
    expect(api.savedPages[1]!.encoders[0]!.press).toBeNull();
  });

  test("preserves the selected profile and draft when activation fails", async () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const first = createEmptyProfile("profile-1", "First", layout, true);
    const second = createEmptyProfile("profile-2", "Second", layout);
    const api = new FakeStudioApi({ layout, profiles: [first, second], activeProfileId: first.id });
    api.activateProfile = async () => err("core_unavailable", "Activation failed.");
    const root = new TestDomRoot();
    mountStudio(root as unknown as HTMLElement, api);
    await flushMicrotasks();
    await element(root, "[data-key='0']").click();
    await element(root, "[data-field='action-url']").input("https://unsaved.example/");
    await element(root, "[data-profile='profile-2']").click();
    expect(element(root, "[data-profile='profile-1']").className).toBe("selected");
    expect(element(root, "[data-field='profile-name']").value).toBe("First");
    expect(element(root, "[data-field='action-url']").value).toBe("https://unsaved.example/");
    expect(root.innerHTML).toContain("Activation failed.");
  });
});

function element(root: TestDomRoot, selector: string): TestDomElement {
  const result = root.querySelector(selector);
  if (!result) throw new Error(`Expected element for ${selector}`);
  return result;
}

function stubPrompt(values: Array<string | null>): () => void {
  let index = 0;
  const target = globalThis as unknown as { window?: { prompt?: () => string | null } };
  const previousWindow = target.window;
  target.window = {
    prompt: () => values[index++] ?? null
  };
  return () => {
    target.window = previousWindow;
  };
}

function actionTargetFromInput(input: Parameters<StudioAPI["sendVirtualInput"]>[0]): ActionExecutionTarget {
  if (input.type === "key") {
    return { type: "key", profileId: input.profileId, pageIndex: input.pageIndex, keyIndex: input.keyIndex };
  }
  return {
    type: "encoder",
    profileId: input.profileId,
    pageIndex: input.pageIndex,
    encoderIndex: input.encoderIndex,
    interaction: input.interaction
  };
}
