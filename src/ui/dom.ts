import { createOpenUrlAction } from "../domain/action";
import type { EncoderBinding, KeyBinding, PageConfig } from "../domain/profile";
import type { Result } from "../shared/result";
import { allowedOpenUrlSchemes } from "../shared/url";
import { keyCount } from "../shared/device-layout";
import type { VirtualInput } from "../application/ports/core-port";
import {
  actionStatusForTarget,
  canStartActionSave,
  canStartProfileOperation,
  canStartVirtualInput,
  initialUIState,
  draftUrlForCurrentTarget,
  markActionDraftChanged,
  markProfileOperationFailed,
  markProfileOperationStarted,
  markProfileOperationSucceeded,
  markSaveFailed,
  markSaveStarted,
  markVirtualInputFailed,
  markVirtualInputStarted,
  reduceCoreEvent,
  selectEncoderTarget,
  selectKeyTarget,
  selectPage,
  selectProfileForEditing,
  selectedPage,
  selectedProfile,
  type UIState
} from "./state";
import type { CoreEvent } from "../application/ports/core-port";
import { profileNameSubmission, profileRenameIntent } from "./profile-name";

export type StudioAPI = {
  getConnectionStatus(): Promise<UIState["connection"]>;
  getSnapshot(): Promise<Result<NonNullable<UIState["snapshot"]>>>;
  createProfile(name: string): Promise<Result<NonNullable<UIState["snapshot"]>>>;
  renameProfile(profileId: string, name: string): Promise<Result<NonNullable<UIState["snapshot"]>>>;
  activateProfile(profileId: string): Promise<Result<NonNullable<UIState["snapshot"]>>>;
  savePage(profileId: string, page: PageConfig): Promise<Result<NonNullable<UIState["snapshot"]>>>;
  sendVirtualInput(input: VirtualInput): Promise<Result<UIState["actionStatus"]>>;
  simulateDisconnect(): Promise<UIState["connection"]>;
  simulateReconnect(): Promise<UIState["connection"]>;
  onCoreEvent(listener: (event: CoreEvent) => void): void;
  ready(): void;
};

type RenderContext = {
  root: HTMLElement;
  api: StudioAPI;
  state: UIState;
};

export function mountStudio(root: HTMLElement, api: StudioAPI) {
  const context: RenderContext = { root, api, state: initialUIState };
  api.onCoreEvent((event) => {
    context.state = reduceCoreEvent(context.state, event);
    render(context);
  });
  api.ready();
  hydrate(context);
  render(context);
}

async function hydrate(context: RenderContext) {
  const snapshot = await context.api.getSnapshot();
  const connection = await context.api.getConnectionStatus();
  context.state = { ...context.state, connection };
  if (snapshot.ok) {
    context.state = reduceCoreEvent(context.state, { type: "snapshot", snapshot: snapshot.value });
  } else {
    context.state = { ...context.state, error: snapshot.error.message };
  }
  render(context);
}

function render(context: RenderContext) {
  const { root, state } = context;
  const profile = selectedProfile(state);
  const page = selectedPage(state);
  const layout = state.snapshot?.layout;

  root.innerHTML = `
    <section class="topbar">
      <div>
        <h1>Keyro Studio</h1>
        <p>${layout ? `${layout.pageCount} pages · ${layout.keyColumns} x ${layout.keyRows} keys · ${layout.encoderCount} encoders` : "Loading device layout"}</p>
      </div>
      <div class="status ${state.connection.state}">
        <span></span>
        ${connectionText(state.connection)}
      </div>
    </section>

    <section class="workspace">
      <aside class="profiles">
        <div class="section-header">
          <h2>Profiles</h2>
          <button data-action="create-profile" title="Create profile" ${canStartProfileOperation(state) ? "" : "disabled"}>+</button>
        </div>
        <div class="profile-list">
          ${state.snapshot?.profiles.map((item) => profileButton(item.id, item.name, item.active, item.id === state.selectedProfileId, canStartProfileOperation(state))).join("") ?? ""}
        </div>
        <div class="profile-state ${state.profileStatus.state}">
          ${profileStatusText(state)}
        </div>
        <div class="connection-tools">
          <button data-action="disconnect">Disconnect</button>
          <button data-action="reconnect">Reconnect</button>
        </div>
      </aside>

      <section class="editor">
        ${profile && page && layout ? editorMarkup(state, profile.id, page) : emptyMarkup(state.error)}
      </section>
    </section>
  `;

  bindEvents(context);
}

function editorMarkup(state: UIState, profileId: string, page: PageConfig): string {
  const layout = state.snapshot!.layout;
  return `
    <div class="editor-header">
      <label>
        <span>Profile name</span>
        <input data-field="profile-name" value="${escapeHtml(selectedProfile(state)?.name ?? "")}" ${canStartProfileOperation(state) ? "" : "disabled"} />
      </label>
      <div class="pages" role="tablist">
        ${Array.from({ length: layout.pageCount }, (_, index) => `
          <button data-page="${index}" class="${index === state.selectedPageIndex ? "selected" : ""}">Page ${index + 1}</button>
        `).join("")}
      </div>
    </div>

    <section class="action-editor">
      ${actionEditorMarkup(state, page)}
    </section>

    <div class="device-area">
      <section class="key-grid" style="grid-template-columns: repeat(${layout.keyColumns}, minmax(96px, 1fr));">
        ${page.keys.map((key) => keyMarkup(state, key)).join("")}
      </section>

      <section class="encoder-panel">
        <h2>Encoders</h2>
        ${page.encoders.map((encoder) => encoderMarkup(state, encoder)).join("")}
      </section>
    </div>

    <section class="save-state ${state.saveStatus.state}">
      ${saveStatusText(state)}
    </section>

    <footer class="run-state ${state.actionStatus.state}">
      ${actionStatusText(state.actionStatus)}
    </footer>

    <input type="hidden" data-profile-id value="${profileId}" />
  `;
}

function keyMarkup(state: UIState, key: KeyBinding): string {
  const label = key.action?.kind === "open_url" ? key.action.url : "Unassigned";
  const status = actionStatusForTarget(state, {
    type: "key",
    pageIndex: state.selectedPageIndex,
    keyIndex: key.index
  });
  return `
    <button class="key-tile ${targetStatusClass(status)}" data-key="${key.index}">
      <strong>K${key.index + 1}</strong>
      <span>${escapeHtml(label)}</span>
      ${targetStatusBadge(status)}
    </button>
  `;
}

function encoderMarkup(state: UIState, encoder: EncoderBinding): string {
  return `
    <div class="encoder" data-encoder="${encoder.index}">
      <div class="encoder-title">Encoder ${encoder.index + 1}</div>
      ${encoderButton(state, encoder.index, "rotateLeft", "Left", encoder.rotateLeft?.url)}
      ${encoderButton(state, encoder.index, "press", "Press", encoder.press?.url)}
      ${encoderButton(state, encoder.index, "rotateRight", "Right", encoder.rotateRight?.url)}
    </div>
  `;
}

function encoderButton(
  state: UIState,
  index: number,
  control: NonNullable<UIState["editingEncoderControl"]>,
  label: string,
  url?: string
): string {
  const status = actionStatusForTarget(state, {
    type: "encoder",
    pageIndex: state.selectedPageIndex,
    encoderIndex: index,
    control
  });
  return `
    <button class="${targetStatusClass(status)}" data-encoder-control="${control}" data-encoder-index="${index}">
      <span>${label}</span>
      <small>${escapeHtml(url ?? "Unassigned")}</small>
      ${targetStatusBadge(status)}
    </button>
  `;
}

function actionEditorMarkup(state: UIState, page: PageConfig): string {
  if (state.editingKeyIndex == null && state.editingEncoderIndex == null) {
    return `<p>Select a key or encoder control to edit its open_url action.</p>`;
  }

  const target =
    state.editingKeyIndex != null
      ? page.keys[state.editingKeyIndex]?.action
      : page.encoders[state.editingEncoderIndex!]?.[state.editingEncoderControl!];
  const url = target?.kind === "open_url" ? target.url : "";
  const draftUrl = draftUrlForCurrentTarget(state) ?? url;
  const label =
    state.editingKeyIndex != null
      ? `Key ${state.editingKeyIndex + 1}`
      : `Encoder ${state.editingEncoderIndex! + 1} ${state.editingEncoderControl}`;

  return `
    <label>
      <span>${label} open_url</span>
      <input data-field="action-url" placeholder="https://example.com" value="${escapeHtml(draftUrl)}" />
    </label>
    <div class="editor-actions">
      <button data-action="save-action" ${canStartActionSave(state) ? "" : "disabled"}>Save</button>
      <button data-action="clear-action" ${canStartActionSave(state) ? "" : "disabled"}>Clear</button>
      <button data-action="simulate-input" ${canStartVirtualInput(state) ? "" : "disabled"}>Run virtual input</button>
    </div>
    <p class="hint">Allowed schemes: ${allowedOpenUrlSchemes().join(", ")}</p>
  `;
}

function bindEvents(context: RenderContext) {
  context.root.querySelector("[data-action='create-profile']")?.addEventListener("click", async () => {
    if (!canStartProfileOperation(context.state)) return;
    const name = window.prompt("Profile name", "New Profile");
    if (name === null) return;
    const submission = profileNameSubmission(name);
    if (submission.kind === "invalid") {
      context.state = markProfileOperationFailed(context.state, submission.message);
      render(context);
      return;
    }
    context.state = markProfileOperationStarted(context.state, "Creating profile...");
    render(context);
    await applyProfileSnapshot(context, context.api.createProfile(submission.normalizedName), "Profile created.");
  });

  context.root.querySelectorAll<HTMLElement>("[data-profile]").forEach((node) => {
    node.addEventListener("click", async () => {
      if (!canStartProfileOperation(context.state)) return;
      context.state = markProfileOperationStarted(context.state, "Activating profile...");
      render(context);
      const profileId = node.dataset.profile!;
      await applyProfileSnapshot(context, context.api.activateProfile(profileId), "Profile activated.", profileId);
    });
  });

  context.root.querySelector("[data-field='profile-name']")?.addEventListener("change", async (event) => {
    if (!canStartProfileOperation(context.state)) return;
    const profileId = context.state.selectedProfileId;
    if (!profileId) return;
    const intent = profileRenameIntent(selectedProfile(context.state)?.name ?? null, (event.target as HTMLInputElement).value);
    if (intent.kind === "invalid") {
      context.state = markProfileOperationFailed(context.state, intent.message);
      render(context);
      return;
    }
    if (intent.kind === "unchanged") {
      context.state = markProfileOperationSucceeded(context.state, intent.message);
      render(context);
      return;
    }
    context.state = markProfileOperationStarted(context.state, "Renaming profile...");
    render(context);
    await applyProfileSnapshot(
      context,
      context.api.renameProfile(profileId, intent.normalizedName),
      "Profile renamed."
    );
  });

  context.root.querySelector("[data-field='action-url']")?.addEventListener("input", (event) => {
    context.state = markActionDraftChanged(context.state, (event.target as HTMLInputElement).value);
    render(context);
  });

  context.root.querySelectorAll<HTMLElement>("[data-page]").forEach((node) => {
    node.addEventListener("click", () => {
      context.state = selectPage(context.state, Number(node.dataset.page));
      render(context);
    });
  });

  context.root.querySelectorAll<HTMLElement>("[data-key]").forEach((node) => {
    node.addEventListener("click", () => {
      context.state = selectKeyTarget(context.state, Number(node.dataset.key));
      render(context);
    });
  });

  context.root.querySelectorAll<HTMLElement>("[data-encoder-control]").forEach((node) => {
    node.addEventListener("click", () => {
      context.state = selectEncoderTarget(
        context.state,
        Number(node.dataset.encoderIndex),
        node.dataset.encoderControl as NonNullable<UIState["editingEncoderControl"]>
      );
      render(context);
    });
  });

  context.root.querySelector("[data-action='save-action']")?.addEventListener("click", async () => {
    await saveCurrentAction(context, false);
  });
  context.root.querySelector("[data-action='clear-action']")?.addEventListener("click", async () => {
    await saveCurrentAction(context, true);
  });
  context.root.querySelector("[data-action='simulate-input']")?.addEventListener("click", async () => {
    await simulateCurrentInput(context);
  });
  context.root.querySelector("[data-action='disconnect']")?.addEventListener("click", async () => {
    context.state = reduceCoreEvent(context.state, { type: "connection", status: await context.api.simulateDisconnect() });
    render(context);
  });
  context.root.querySelector("[data-action='reconnect']")?.addEventListener("click", async () => {
    context.state = reduceCoreEvent(context.state, { type: "connection", status: await context.api.simulateReconnect() });
    render(context);
  });
}

async function saveCurrentAction(context: RenderContext, clear: boolean) {
  if (!canStartActionSave(context.state)) return;
  const page = selectedPage(context.state);
  const profile = selectedProfile(context.state);
  if (!page || !profile) return;
  const nextPage = structuredClone(page);
  const draftInput = context.root.querySelector("[data-field='action-url']") as HTMLInputElement | null;
  const actionResult = clear
    ? null
    : createOpenUrlAction(draftUrlForCurrentTarget(context.state) ?? draftInput?.value ?? "");
  if (actionResult && !actionResult.ok) {
    context.state = markSaveFailed(context.state, actionResult.error.message);
    render(context);
    return;
  }
  const nextAction = actionResult?.ok ? actionResult.value : null;

  if (context.state.editingKeyIndex != null) {
    nextPage.keys[context.state.editingKeyIndex]!.action = nextAction;
  } else if (context.state.editingEncoderIndex != null && context.state.editingEncoderControl) {
    nextPage.encoders[context.state.editingEncoderIndex]![context.state.editingEncoderControl] = nextAction;
  }

  context.state = markSaveStarted(context.state);
  render(context);
  await applySnapshot(context, context.api.savePage(profile.id, nextPage));
}

async function simulateCurrentInput(context: RenderContext) {
  if (!canStartVirtualInput(context.state)) return;
  const profile = selectedProfile(context.state);
  if (!profile) return;
  context.state = markVirtualInputStarted(context.state);
  render(context);
  let result: Result<UIState["actionStatus"]> | null = null;
  if (context.state.editingKeyIndex != null) {
    result = await context.api.sendVirtualInput({
      type: "key",
      profileId: profile.id,
      pageIndex: context.state.selectedPageIndex,
      keyIndex: context.state.editingKeyIndex
    });
  } else if (context.state.editingEncoderIndex != null && context.state.editingEncoderControl) {
    result = await context.api.sendVirtualInput({
      type: "encoder",
      profileId: profile.id,
      pageIndex: context.state.selectedPageIndex,
      encoderIndex: context.state.editingEncoderIndex,
      interaction: context.state.editingEncoderControl
    });
  }
  if (result && !result.ok) {
    context.state = markVirtualInputFailed(context.state, result.error.message);
    render(context);
  }
}

async function applySnapshot(context: RenderContext, pending: Promise<Result<NonNullable<UIState["snapshot"]>>>) {
  const result = await pending;
  if (result.ok) {
    context.state = reduceCoreEvent({ ...context.state, error: null }, { type: "snapshot", snapshot: result.value });
  } else {
    context.state = markSaveFailed(context.state, result.error.message);
  }
  render(context);
}

async function applyProfileSnapshot(
  context: RenderContext,
  pending: Promise<Result<NonNullable<UIState["snapshot"]>>>,
  successMessage: string,
  selectedProfileId?: string
) {
  const result = await pending;
  if (result.ok) {
    context.state = markProfileOperationSucceeded(
      reduceCoreEvent({ ...context.state, error: null }, { type: "snapshot", snapshot: result.value }),
      successMessage
    );
    if (selectedProfileId) {
      context.state = selectProfileForEditing(context.state, selectedProfileId);
    }
  } else {
    context.state = markProfileOperationFailed(context.state, result.error.message);
  }
  render(context);
}

function profileButton(id: string, name: string, active: boolean, selected: boolean, enabled: boolean): string {
  return `<button data-profile="${id}" class="${selected ? "selected" : ""}" ${enabled ? "" : "disabled"}>${escapeHtml(name)}${active ? "<span>Active</span>" : ""}</button>`;
}

function emptyMarkup(error: string | null): string {
  return `<div class="empty">${escapeHtml(error ?? "Waiting for Core snapshot.")}</div>`;
}

function connectionText(status: UIState["connection"]): string {
  if (status.state === "disconnected" || status.state === "reconnecting") return `${status.state}: ${status.reason ?? ""}`;
  if (status.state === "error") return status.message;
  return status.state;
}

function actionStatusText(status: UIState["actionStatus"]): string {
  if (status.state === "idle") return "No action has run yet.";
  if (status.state === "running") return `${actionTargetText(status.target)}: running`;
  return `${actionTargetText(status.target)}: ${status.message}`;
}

function actionTargetText(target: NonNullable<Exclude<UIState["actionStatus"], { state: "idle" }>["target"]>): string {
  if (target.type === "key") {
    return `Page ${target.pageIndex + 1} Key ${target.keyIndex + 1}`;
  }
  return `Page ${target.pageIndex + 1} Encoder ${target.encoderIndex + 1} ${target.interaction}`;
}

function targetStatusClass(status: UIState["actionStatus"] | null): string {
  return status && status.state !== "idle" ? `target-${status.state}` : "";
}

function targetStatusBadge(status: UIState["actionStatus"] | null): string {
  if (!status || status.state === "idle") return `<em class="target-status empty" aria-hidden="true"></em>`;
  const label = status.state === "running" ? "Running" : status.state === "success" ? "Success" : "Failed";
  return `<em class="target-status">${label}</em>`;
}

function saveStatusText(state: UIState): string {
  if (state.connection.state !== "connected" && state.saveStatus.state !== "saving") {
    return state.saveStatus.state === "dirty" || state.saveStatus.state === "failed"
      ? state.saveStatus.message
      : "Disconnected. Edits cannot be saved until Core reconnects.";
  }
  if (state.saveStatus.state === "idle") return "No unsaved changes.";
  return state.saveStatus.message;
}

function profileStatusText(state: UIState): string {
  if (state.connection.state !== "connected" && state.profileStatus.state !== "working") {
    return state.profileStatus.state === "failed"
      ? state.profileStatus.message
      : "Profiles cannot be changed until Core reconnects.";
  }
  if (state.profileStatus.state === "idle") return "No profile changes in progress.";
  return state.profileStatus.message;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function describeGridColumns(rows: number, columns: number): string {
  return `${rows}x${columns}:${keyCount({ pageCount: 1, keyRows: rows, keyColumns: columns, encoderCount: 1 })}`;
}
