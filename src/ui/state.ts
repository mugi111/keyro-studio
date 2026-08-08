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
  draftActionUrl: string | null;
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

export const initialUIState: UIState = {
  connection: { state: "connecting" },
  snapshot: null,
  selectedProfileId: null,
  selectedPageIndex: 0,
  actionStatus: { state: "idle" },
  saveStatus: { state: "idle" },
  draftActionUrl: null,
  editingKeyIndex: null,
  editingEncoderIndex: null,
  editingEncoderControl: null,
  error: null
};

export function reduceCoreEvent(state: UIState, event: CoreEvent): UIState {
  if (event.type === "connection") {
    return { ...state, connection: event.status };
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
    draftActionUrl: state.saveStatus.state === "saving" ? null : state.draftActionUrl
  };
}

export function markActionDraftChanged(state: UIState, url: string): UIState {
  return {
    ...state,
    draftActionUrl: url,
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
    draftActionUrl: null,
    saveStatus: { state: "saved", message: "Saved to Core." },
    error: null
  };
}

export function selectedProfile(state: UIState): Profile | null {
  return state.snapshot?.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null;
}

export function selectedPage(state: UIState): PageConfig | null {
  return selectedProfile(state)?.pages[state.selectedPageIndex] ?? null;
}
