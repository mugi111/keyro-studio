import { describe, expect, test } from "bun:test";
import type { PageConfig, StudioSnapshot } from "../src/domain/profile";
import { createEmptyProfile } from "../src/domain/profile";
import type { ActionExecutionStatus } from "../src/application/ports/action-executor-port";
import type { ConnectionStatus, CoreEvent } from "../src/application/ports/core-port";
import { mountStudio, type StudioAPI } from "../src/ui/dom";
import { ok, type Result } from "../src/shared/result";
import { flushMicrotasks, TestDomElement, TestDomRoot } from "./helpers/test-dom";

class FakeStudioApi implements StudioAPI {
  readonly savedPages: PageConfig[] = [];
  readonly createdProfiles: string[] = [];
  readonly renamedProfiles: Array<{ profileId: string; name: string }> = [];
  readonly activatedProfiles: string[] = [];
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

  async sendVirtualInput(): Promise<Result<ActionExecutionStatus>> {
    return ok({ state: "idle" });
  }

  async simulateDisconnect(): Promise<ConnectionStatus> {
    return { state: "disconnected", reason: "Test disconnect" };
  }

  async simulateReconnect(): Promise<ConnectionStatus> {
    return { state: "connected" };
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
    expect(root.innerHTML).toContain('data-profile="profile-2" class="" >Second<span>Active</span>');
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
