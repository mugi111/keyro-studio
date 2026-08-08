import { describe, expect, test } from "bun:test";
import { describeGridColumns } from "../src/ui/dom";
import {
  clearSaveDraft,
  initialUIState,
  markActionDraftChanged,
  markSaveFailed,
  markSaveStarted,
  reduceCoreEvent
} from "../src/ui/state";
import { createEmptyProfile } from "../src/domain/profile";

describe("ui state", () => {
  test("selects active profile and clamps selected page", () => {
    const layout = { pageCount: 2, keyRows: 2, keyColumns: 2, encoderCount: 1 };
    const profile = createEmptyProfile("p1", "Default", layout, true);
    const state = reduceCoreEvent(
      { ...initialUIState, selectedPageIndex: 99 },
      { type: "snapshot", snapshot: { layout, profiles: [profile], activeProfileId: "p1" } }
    );

    expect(state.selectedProfileId).toBe("p1");
    expect(state.selectedPageIndex).toBe(1);
  });

  test("describes variable key grids for component tests", () => {
    expect(describeGridColumns(3, 4)).toBe("3x4:12");
    expect(describeGridColumns(2, 5)).toBe("2x5:10");
  });

  test("tracks dirty and saving states for action drafts", () => {
    const dirty = markActionDraftChanged(initialUIState, "https://example.com");
    expect(dirty.saveStatus.state).toBe("dirty");
    expect(dirty.draftActionUrl).toBe("https://example.com");

    const saving = markSaveStarted(dirty);
    expect(saving.saveStatus.state).toBe("saving");
    expect(saving.error).toBeNull();

    const saved = clearSaveDraft(saving);
    expect(saved.saveStatus.state).toBe("saved");
    expect(saved.draftActionUrl).toBeNull();
  });

  test("keeps failed saves distinct from saved state", () => {
    const disconnected = {
      ...initialUIState,
      connection: { state: "disconnected" as const, reason: "Core stopped." }
    };
    const dirty = markActionDraftChanged(disconnected, "https://example.com");
    const failed = markSaveFailed(dirty, "Core is disconnected.");

    expect(dirty.saveStatus).toEqual({ state: "dirty", message: "Disconnected. Changes are not saved." });
    expect(failed.saveStatus).toEqual({ state: "failed", message: "Core is disconnected." });
    expect(failed.draftActionUrl).toBe("https://example.com");
  });

  test("snapshot acknowledgement after saving clears draft", () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("p1", "Default", layout, true);
    const saving = markSaveStarted(markActionDraftChanged(initialUIState, "https://example.com"));
    const state = reduceCoreEvent(saving, {
      type: "snapshot",
      snapshot: { layout, profiles: [profile], activeProfileId: "p1" }
    });

    expect(state.saveStatus.state).toBe("saved");
    expect(state.draftActionUrl).toBeNull();
  });
});
