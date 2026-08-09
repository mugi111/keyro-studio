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
  readyCalls = 0;
  private listener: ((event: CoreEvent) => void) | null = null;

  constructor(private snapshot: StudioSnapshot) {}

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return { state: "connected" };
  }

  async getSnapshot(): Promise<Result<StudioSnapshot>> {
    return ok(structuredClone(this.snapshot));
  }

  async createProfile(): Promise<Result<StudioSnapshot>> {
    return ok(structuredClone(this.snapshot));
  }

  async renameProfile(): Promise<Result<StudioSnapshot>> {
    return ok(structuredClone(this.snapshot));
  }

  async activateProfile(): Promise<Result<StudioSnapshot>> {
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
});

function element(root: TestDomRoot, selector: string): TestDomElement {
  const result = root.querySelector(selector);
  if (!result) throw new Error(`Expected element for ${selector}`);
  return result;
}
