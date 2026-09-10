import { describe, expect, test } from "bun:test";
import { describeGridColumns } from "../src/ui/dom";
import {
  actionStatusForTarget,
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
  markVirtualInputFailed,
  markVirtualInputStarted,
  reduceCoreEvent,
  selectKeyTarget,
  selectEncoderTarget,
  selectProfileForEditing
} from "../src/ui/state";
import { createEmptyProfile } from "../src/domain/profile";
import { profileNameSubmission, profileRenameIntent, type ProfileRenameIntent } from "../src/ui/profile-name";

describe("ui state", () => {
  const keyTarget = { type: "key" as const, profileId: "p1", pageIndex: 0, keyIndex: 1 };
  const encoderTarget = {
    type: "encoder" as const,
    profileId: "p1",
    pageIndex: 1,
    encoderIndex: 0,
    interaction: "rotateRight" as const
  };

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

  test("profile selection clears encoder drafts and old save failures but preserves the page", () => {
    const layout = { pageCount: 2, keyRows: 1, keyColumns: 1, encoderCount: 1 };
    const profiles = [createEmptyProfile("p1", "First", layout, true), createEmptyProfile("p2", "Second", layout)];
    const loaded = reduceCoreEvent({ ...initialUIState, selectedPageIndex: 1 }, {
      type: "snapshot", snapshot: { layout, profiles, activeProfileId: "p1" }
    });
    const editing = markSaveFailed(
      markActionDraftChanged(selectEncoderTarget(loaded, 0, "press"), "https://draft.example/"),
      "Save failed."
    );
    expect(selectProfileForEditing(editing, "p1")).toBe(editing);
    expect(selectProfileForEditing(editing, "missing")).toBe(editing);
    const switched = selectProfileForEditing(editing, "p2");
    expect(switched.selectedProfileId).toBe("p2");
    expect(switched.selectedPageIndex).toBe(1);
    expect(switched.actionDraft).toBeNull();
    expect(switched.editingKeyIndex).toBeNull();
    expect(switched.editingEncoderIndex).toBeNull();
    expect(switched.editingEncoderControl).toBeNull();
    expect(switched.saveStatus.state).toBe("idle");
    expect(switched.error).toBeNull();
  });

  test("prevents profile mutations during saves and saves or virtual input during profile mutations", () => {
    const connected = { ...initialUIState, connection: { state: "connected" as const } };
    expect(canStartProfileOperation(markSaveStarted(connected))).toBe(false);
    const switching = markProfileOperationStarted(connected, "Activating profile...");
    expect(canStartActionSave(switching)).toBe(false);
    expect(canStartVirtualInput(switching)).toBe(false);
    const completed = markProfileOperationSucceeded(switching, "Profile activated.");
    expect(canStartActionSave(completed)).toBe(true);
    expect(canStartVirtualInput(completed)).toBe(true);
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

  test("normalizes creatable profile names and rejects blank input", () => {
    expect(profileNameSubmission("  Focus   Mode  ")).toEqual({ kind: "submit", normalizedName: "Focus Mode" });
    expect(profileNameSubmission("   ")).toEqual({ kind: "invalid", message: "Profile name is required." });
  });

  test("classifies profile rename input before calling RPC", () => {
    expect(profileRenameIntent("Focus Mode", "  Focus   Mode  ")).toEqual({
      kind: "unchanged",
      normalizedName: "Focus Mode",
      message: "Profile name unchanged."
    });
    expect(profileRenameIntent("Focus Mode", "  Studio   Mode  ")).toEqual({
      kind: "submit",
      normalizedName: "Studio Mode"
    });
    expect(profileRenameIntent("Focus Mode", "   ")).toEqual({
      kind: "invalid",
      message: "Profile name is required."
    });
    expect(profileRenameIntent(null, "Studio Mode")).toEqual({
      kind: "invalid",
      message: "No profile is selected."
    });
  });

  test("submits renames only when the normalized name changes", () => {
    const submitted: string[] = [];
    const submitRename = (intent: ProfileRenameIntent) => {
      if (intent.kind === "submit") submitted.push(intent.normalizedName);
    };

    submitRename(profileRenameIntent("Focus Mode", "  Focus   Mode  "));
    submitRename(profileRenameIntent("Focus Mode", "   "));
    submitRename(profileRenameIntent("Focus Mode", "Studio Mode"));

    expect(submitted).toEqual(["Studio Mode"]);
  });

  test("blocks duplicate operations while each operation is running", () => {
    const connected = { ...initialUIState, connection: { state: "connected" as const } };
    const saving = markSaveStarted(connected);
    const profileWorking = markProfileOperationStarted(connected, "Creating profile...");
    const actionRunning = {
      ...connected,
      actionStatus: { state: "running" as const, target: keyTarget }
    };

    expect(canStartActionSave(saving)).toBe(false);
    expect(canStartActionSave(initialUIState)).toBe(false);
    expect(canStartActionSave(connected)).toBe(true);
    expect(canStartProfileOperation(profileWorking)).toBe(false);
    expect(canStartProfileOperation(initialUIState)).toBe(false);
    expect(canStartProfileOperation(connected)).toBe(true);
    expect(canStartVirtualInput(actionRunning)).toBe(false);
    expect(canStartVirtualInput(initialUIState)).toBe(false);
    expect(canStartVirtualInput(connected)).toBe(true);
  });

  test("marks virtual input running before the Core event returns", () => {
    const started = markVirtualInputStarted(
      selectKeyTarget({ ...initialUIState, selectedProfileId: "p1" }, 0)
    );

    expect(started.actionStatus).toEqual({
      state: "running",
      target: { type: "key", profileId: "p1", pageIndex: 0, keyIndex: 0 }
    });
    expect(canStartVirtualInput(started)).toBe(false);
  });

  test("marks virtual input failure when the RPC returns an error", () => {
    const started = markVirtualInputStarted(
      selectKeyTarget({ ...initialUIState, selectedProfileId: "p1" }, 0)
    );
    const failed = markVirtualInputFailed(started, "Core is disconnected.");

    expect(failed.actionStatus).toEqual({
      state: "failure",
      target: { type: "key", profileId: "p1", pageIndex: 0, keyIndex: 0 },
      code: "internal",
      message: "Core is disconnected."
    });
    expect(canStartVirtualInput({ ...failed, connection: { state: "connected" } })).toBe(true);
    expect(failed.error).toBe("Core is disconnected.");
  });

  test("maps action execution status only to its matching key target", () => {
    const state = {
      ...initialUIState,
      selectedProfileId: "p1",
      actionStatus: { state: "success" as const, target: keyTarget, message: "Action completed." }
    };

    expect(actionStatusForTarget(state, { type: "key", pageIndex: 0, keyIndex: 1 })).toEqual(state.actionStatus);
    expect(actionStatusForTarget(state, { type: "key", pageIndex: 0, keyIndex: 0 })).toBeNull();
    expect(actionStatusForTarget(state, { type: "key", pageIndex: 1, keyIndex: 1 })).toBeNull();
    expect(actionStatusForTarget({ ...state, selectedProfileId: "p2" }, { type: "key", pageIndex: 0, keyIndex: 1 })).toBeNull();
  });

  test("maps action execution status only to its matching encoder target", () => {
    const state = {
      ...initialUIState,
      selectedProfileId: "p1",
      actionStatus: {
        state: "failure" as const,
        target: encoderTarget,
        code: "open_url_failed" as const,
        message: "Action failed."
      }
    };

    expect(
      actionStatusForTarget(state, { type: "encoder", pageIndex: 1, encoderIndex: 0, control: "rotateRight" })
    ).toEqual(state.actionStatus);
    expect(
      actionStatusForTarget(state, { type: "encoder", pageIndex: 1, encoderIndex: 0, control: "rotateLeft" })
    ).toBeNull();
    expect(actionStatusForTarget(state, { type: "key", pageIndex: 1, keyIndex: 0 })).toBeNull();
  });
});
