import { afterEach, describe, expect, test } from "bun:test";
import { createEmptyProfile, type StudioSnapshot } from "../src/domain/profile";
import { mountStudio, type StudioAPI } from "../src/ui/dom";
import { ok } from "../src/shared/result";
import { Window as HappyDOMWindow } from "happy-dom";

type ProfileCalls = {
  create: string[];
  rename: Array<{ profileId: string; name: string }>;
  activate: string[];
};

const windows: HappyDOMWindow[] = [];

afterEach(() => {
  for (const window of windows.splice(0)) {
    window.close();
  }
  delete (globalThis as unknown as { window?: HappyDOMWindow }).window;
});

describe("profile management DOM flow", () => {
  test("creates a normalized profile and rejects a blank creation name", async () => {
    const { root, calls } = mountProfileEditor(["  Focus   Mode  ", "   "]);

    await click(root, "[data-action='create-profile']");

    expect(calls.create).toEqual(["Focus Mode"]);
    expect(root.textContent).toContain("Focus Mode");

    await click(root, "[data-action='create-profile']");

    expect(calls.create).toEqual(["Focus Mode"]);
    expect(root.textContent).toContain("Profile name is required.");
  });

  test("skips an unchanged rename, rejects blanks, and normalizes submitted names", async () => {
    const { root, calls } = mountProfileEditor();

    await changeInput(root, "[data-field='profile-name']", " Default ");

    expect(calls.rename).toEqual([]);
    expect(root.textContent).toContain("Profile name is unchanged.");

    await changeInput(root, "[data-field='profile-name']", "   ");

    expect(calls.rename).toEqual([]);
    expect(root.textContent).toContain("Profile name is required.");

    await changeInput(root, "[data-field='profile-name']", " Deep   Work ");

    expect(calls.rename).toEqual([{ profileId: "profile-default", name: "Deep Work" }]);
    expect(root.querySelector<HTMLInputElement>("[data-field='profile-name']")?.value).toBe("Deep Work");
  });

  test("activates a profile from the profile list", async () => {
    const { root, calls } = mountProfileEditor();

    await click(root, "[data-profile='profile-second']");

    expect(calls.activate).toEqual(["profile-second"]);
    expect(root.querySelector("[data-profile='profile-second']")?.textContent).toContain("Active");
    expect(root.querySelector("[data-profile='profile-default']")?.textContent).not.toContain("Active");
  });
});

function mountProfileEditor(promptValues: string[] = []) {
  const window = new HappyDOMWindow();
  windows.push(window);
  (globalThis as unknown as { window?: HappyDOMWindow }).window = window;
  const root = window.document.createElement("div") as unknown as HTMLElement;
  const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
  let nextProfileNumber = 1;
  let snapshot: StudioSnapshot = {
    layout,
    profiles: [
      createEmptyProfile("profile-default", "Default", layout, true),
      createEmptyProfile("profile-second", "Second", layout)
    ],
    activeProfileId: "profile-default"
  };
  const calls: ProfileCalls = { create: [], rename: [], activate: [] };

  const api: StudioAPI = {
    getConnectionStatus: async () => ({ state: "connected" }),
    getSnapshot: async () => ok(snapshot),
    createProfile: async (name) => {
      calls.create.push(name);
      const profile = createEmptyProfile(`profile-${nextProfileNumber++}`, name, layout);
      snapshot = { ...snapshot, profiles: [...snapshot.profiles, profile] };
      return ok(snapshot);
    },
    renameProfile: async (profileId, name) => {
      calls.rename.push({ profileId, name });
      snapshot = {
        ...snapshot,
        profiles: snapshot.profiles.map((profile) => (profile.id === profileId ? { ...profile, name } : profile))
      };
      return ok(snapshot);
    },
    activateProfile: async (profileId) => {
      calls.activate.push(profileId);
      snapshot = {
        ...snapshot,
        activeProfileId: profileId,
        profiles: snapshot.profiles.map((profile) => ({ ...profile, active: profile.id === profileId }))
      };
      return ok(snapshot);
    },
    savePage: async () => ok(snapshot),
    sendVirtualInput: async () => ok({ state: "idle" }),
    simulateDisconnect: async () => ({ state: "disconnected", reason: "test" }),
    simulateReconnect: async () => ({ state: "connected" }),
    onCoreEvent: () => {},
    ready: () => {}
  };
  let promptIndex = 0;
  (window as unknown as { prompt: () => string | null }).prompt = () => promptValues[promptIndex++] ?? null;

  mountStudio(root, api);
  return { root, calls };
}

async function click(root: HTMLElement, selector: string) {
  await settle();
  const target = root.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`Missing ${selector}`);
  target.click();
  await settle();
}

async function changeInput(root: HTMLElement, selector: string, value: string) {
  await settle();
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
