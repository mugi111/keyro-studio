import type { PageConfig, Profile, StudioSnapshot } from "../domain/profile";
import type { ActionExecutionStatus } from "../application/ports/action-executor-port";
import type {
  ConnectionStatus,
  CoreEvent
} from "../application/ports/core-port";

export type UIState = {
  connection: ConnectionStatus;
  snapshot: StudioSnapshot | null;
  selectedProfileId: string | null;
  selectedPageIndex: number;
  actionStatus: ActionExecutionStatus;
  saveStatus: SaveStatus;
  actionDraft: ActionDraft | null;
  editingKeyIndex: number | null;
  editingEncoderIndex: number | null;
  editingEncoderControl: "rotateLeft" | "rotateRight" | "press" | null;
  error: string | null;
};

export type SaveStatus =
  | { state: "idle" }
  | { state: "dirty"; message: string }
  | { state: "saving"; message: string }
  | { state: "saved"; message: string }
  | { state: "failed"; message: string };

export type ActionEditTarget =
  | { type: "key"; pageIndex: number; keyIndex: number }
  | {
      type: "encoder";
      pageIndex: number;
      encoderIndex: number;
      control: "rotateLeft" | "rotateRight" | "press";
    };

export type ActionDraft = {
  target: ActionEditTarget;
  url: string;
};

export const initialUIState: UIState = {
  connection: { state: "connecting" },
  snapshot: null,
  selectedProfileId: null,
  selectedPageIndex: 0,
  actionStatus: { state: "idle" },
  saveStatus: { state: "idle" },
  actionDraft: null,
  editingKeyIndex: null,
  editingEncoderIndex: null,
  editingEncoderControl: null,
  error: null
};

export function reduceCoreEvent(state: UIState, event: CoreEvent): UIState {
  if (event.type === "connection") {
    return {
      ...state,
      connection: event.status,
      saveStatus: normalizeSaveStatusForConnection(state.saveStatus, event.status, state.actionDraft)
    };
  }
  if (event.type === "action") {
    return { ...state, actionStatus: event.status };
  }

  const activeProfileId = event.snapshot.activeProfileId ?? event.snapshot.profiles[0]?.id ?? null;
  const selectedProfileId = state.selectedProfileId
    ? event.snapshot.profiles.find((profile) => profile.id === state.selectedProfileId)?.id ?? activeProfileId
    : activeProfileId;

  return {
    ...state,
    snapshot: event.snapshot,
    selectedProfileId,
    selectedPageIndex: Math.min(state.selectedPageIndex, event.snapshot.layout.pageCount - 1),
    saveStatus: state.saveStatus.state === "saving" ? { state: "saved", message: "Saved to Core." } : state.saveStatus,
    actionDraft: state.saveStatus.state === "saving" ? null : state.actionDraft
  };
}

export function markActionDraftChanged(state: UIState, url: string): UIState {
  const target = currentEditTarget(state);
  if (!target) return state;
  return {
    ...state,
    actionDraft: { target, url },
    saveStatus:
      state.connection.state === "connected"
        ? { state: "dirty", message: "Unsaved changes." }
        : { state: "dirty", message: "Disconnected. Changes are not saved." }
  };
}

export function markSaveStarted(state: UIState): UIState {
  return {
    ...state,
    saveStatus: { state: "saving", message: "Saving to Core..." },
    error: null
  };
}

export function markSaveFailed(state: UIState, message: string): UIState {
  return {
    ...state,
    saveStatus: { state: "failed", message },
    error: message
  };
}

export function clearSaveDraft(state: UIState): UIState {
  return {
    ...state,
    actionDraft: null,
    saveStatus: { state: "saved", message: "Saved to Core." },
    error: null
  };
}

export function selectPage(state: UIState, pageIndex: number): UIState {
  return clearEditingTarget({
    ...state,
    selectedPageIndex: pageIndex
  });
}

export function selectKeyTarget(state: UIState, keyIndex: number): UIState {
  return clearDraftIfTargetChanged({
    ...state,
    editingKeyIndex: keyIndex,
    editingEncoderIndex: null,
    editingEncoderControl: null
  });
}

export function selectEncoderTarget(
  state: UIState,
  encoderIndex: number,
  control: "rotateLeft" | "rotateRight" | "press"
): UIState {
  return clearDraftIfTargetChanged({
    ...state,
    editingKeyIndex: null,
    editingEncoderIndex: encoderIndex,
    editingEncoderControl: control
  });
}

export function draftUrlForCurrentTarget(state: UIState): string | null {
  const target = currentEditTarget(state);
  if (!target || !state.actionDraft) return null;
  return sameEditTarget(target, state.actionDraft.target) ? state.actionDraft.url : null;
}

function clearEditingTarget(state: UIState): UIState {
  return {
    ...state,
    editingKeyIndex: null,
    editingEncoderIndex: null,
    editingEncoderControl: null,
    actionDraft: null,
    saveStatus: state.saveStatus.state === "dirty" ? { state: "idle" } : state.saveStatus
  };
}

function clearDraftIfTargetChanged(state: UIState): UIState {
  const target = currentEditTarget(state);
  if (!target || !state.actionDraft || sameEditTarget(target, state.actionDraft.target)) {
    return state;
  }
  return {
    ...state,
    actionDraft: null,
    saveStatus: state.saveStatus.state === "dirty" ? { state: "idle" } : state.saveStatus
  };
}

function currentEditTarget(state: UIState): ActionEditTarget | null {
  if (state.editingKeyIndex != null) {
    return { type: "key", pageIndex: state.selectedPageIndex, keyIndex: state.editingKeyIndex };
  }
  if (state.editingEncoderIndex != null && state.editingEncoderControl) {
    return {
      type: "encoder",
      pageIndex: state.selectedPageIndex,
      encoderIndex: state.editingEncoderIndex,
      control: state.editingEncoderControl
    };
  }
  return null;
}

function sameEditTarget(left: ActionEditTarget, right: ActionEditTarget): boolean {
  if (left.type !== right.type || left.pageIndex !== right.pageIndex) return false;
  if (left.type === "key" && right.type === "key") return left.keyIndex === right.keyIndex;
  if (left.type === "encoder" && right.type === "encoder") {
    return left.encoderIndex === right.encoderIndex && left.control === right.control;
  }
  return false;
}

function normalizeSaveStatusForConnection(
  status: SaveStatus,
  connection: ConnectionStatus,
  draft: ActionDraft | null
): SaveStatus {
  if (connection.state === "connected") {
    if (draft && status.state === "failed") {
      return { state: "dirty", message: "Reconnected. Changes are not saved yet." };
    }
    return status;
  }
  if (status.state !== "dirty" && !(draft && status.state === "failed")) return status;
  return { state: status.state, message: "Disconnected. Changes are not saved." };
}

export function selectedProfile(state: UIState): Profile | null {
  return state.snapshot?.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null;
}

export function selectedPage(state: UIState): PageConfig | null {
  return selectedProfile(state)?.pages[state.selectedPageIndex] ?? null;
}
