import { describe, expect, test } from "bun:test";
import { describeGridColumns } from "../src/ui/dom";
import {
  canStartActionSave,
  canStartProfileOperation,
  canStartVirtualInput,
  clearSaveDraft,
  draftUrlForCurrentTarget,
  initialUIState,
  markActionDraftChanged,
  markProfileOperationFailed,
  markProfileOperationStarted,
  markProfileOperationSucceeded,
  markSaveFailed,
  markSaveStarted,
  markVirtualInputStarted,
  reduceCoreEvent,
  selectKeyTarget
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
    const dirty = markActionDraftChanged(selectKeyTarget(initialUIState, 0), "https://example.com");
    expect(dirty.saveStatus.state).toBe("dirty");
    expect(dirty.actionDraft?.url).toBe("https://example.com");

    const saving = markSaveStarted(dirty);
    expect(saving.saveStatus.state).toBe("saving");
    expect(saving.error).toBeNull();

    const saved = clearSaveDraft(saving);
    expect(saved.saveStatus.state).toBe("saved");
    expect(saved.actionDraft).toBeNull();
  });

  test("keeps failed saves distinct from saved state", () => {
    const disconnected = {
      ...selectKeyTarget(initialUIState, 0),
      connection: { state: "disconnected" as const, reason: "Core stopped." }
    };
    const dirty = markActionDraftChanged(disconnected, "https://example.com");
    const failed = markSaveFailed(dirty, "Core is disconnected.");

    expect(dirty.saveStatus).toEqual({ state: "dirty", message: "Disconnected. Changes are not saved." });
    expect(failed.saveStatus).toEqual({ state: "failed", message: "Core is disconnected." });
    expect(failed.actionDraft?.url).toBe("https://example.com");
  });

  test("snapshot acknowledgement after saving clears draft", () => {
    const layout = { pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profile = createEmptyProfile("p1", "Default", layout, true);
    const saving = markSaveStarted(markActionDraftChanged(selectKeyTarget(initialUIState, 0), "https://example.com"));
    const state = reduceCoreEvent(saving, {
      type: "snapshot",
      snapshot: { layout, profiles: [profile], activeProfileId: "p1" }
    });

    expect(state.saveStatus.state).toBe("saved");
    expect(state.actionDraft).toBeNull();
  });

  test("clears action draft when switching edit targets", () => {
    const editingKeyOne = selectKeyTarget(initialUIState, 0);
    const dirty = markActionDraftChanged(editingKeyOne, "https://example.com/key-1");
    const editingKeyTwo = selectKeyTarget(dirty, 1);

    expect(draftUrlForCurrentTarget(dirty)).toBe("https://example.com/key-1");
    expect(editingKeyTwo.actionDraft).toBeNull();
    expect(draftUrlForCurrentTarget(editingKeyTwo)).toBeNull();
  });

  test("updates dirty save message when Core disconnects", () => {
    const dirty = markActionDraftChanged(selectKeyTarget(initialUIState, 0), "https://example.com");
    const disconnected = reduceCoreEvent(dirty, {
      type: "connection",
      status: { state: "disconnected", reason: "Core stopped." }
    });

    expect(disconnected.saveStatus).toEqual({ state: "dirty", message: "Disconnected. Changes are not saved." });
  });

  test("keeps failed draft resavable after Core reconnects", () => {
    const disconnected = {
      ...selectKeyTarget(initialUIState, 0),
      connection: { state: "disconnected" as const, reason: "Core stopped." }
    };
    const dirty = markActionDraftChanged(disconnected, "https://example.com/retry");
    const failed = markSaveFailed(dirty, "Core is disconnected.");
    const reconnected = reduceCoreEvent(failed, {
      type: "connection",
      status: { state: "connected" }
    });

    expect(reconnected.actionDraft?.url).toBe("https://example.com/retry");
    expect(draftUrlForCurrentTarget(reconnected)).toBe("https://example.com/retry");
    expect(reconnected.saveStatus).toEqual({ state: "dirty", message: "Reconnected. Changes are not saved yet." });
  });

  test("tracks profile operation status independently from action saves", () => {
    const connected = { ...initialUIState, connection: { state: "connected" as const } };
    const dirty = markActionDraftChanged(selectKeyTarget(connected, 0), "https://example.com");
    const working = markProfileOperationStarted(dirty, "Renaming profile...");
    const failed = markProfileOperationFailed(working, "Core is disconnected.");
    const succeeded = markProfileOperationSucceeded(failed, "Profile renamed.");

    expect(working.profileStatus).toEqual({ state: "working", message: "Renaming profile..." });
    expect(failed.profileStatus).toEqual({ state: "failed", message: "Core is disconnected." });
    expect(failed.saveStatus).toEqual({ state: "dirty", message: "Unsaved changes." });
    expect(succeeded.profileStatus).toEqual({ state: "success", message: "Profile renamed." });
    expect(succeeded.error).toBeNull();
  });

  test("blocks duplicate operations while each operation is running", () => {
    const saving = markSaveStarted(initialUIState);
    const profileWorking = markProfileOperationStarted(initialUIState, "Creating profile...");
    const actionRunning = {
      ...initialUIState,
      actionStatus: { state: "running" as const, target: "Page 1 Key 1" }
    };

    expect(canStartActionSave(saving)).toBe(false);
    expect(canStartActionSave(initialUIState)).toBe(true);
    expect(canStartProfileOperation(profileWorking)).toBe(false);
    expect(canStartProfileOperation(initialUIState)).toBe(true);
    expect(canStartVirtualInput(actionRunning)).toBe(false);
    expect(canStartVirtualInput(initialUIState)).toBe(true);
  });

  test("marks virtual input running before the Core event returns", () => {
    const started = markVirtualInputStarted(selectKeyTarget(initialUIState, 0));

    expect(started.actionStatus).toEqual({ state: "running", target: "Page 1 Key 1" });
    expect(canStartVirtualInput(started)).toBe(false);
  });
});
