import { createOpenUrlAction } from "../domain/action";
import type { EncoderBinding, KeyBinding, PageConfig } from "../domain/profile";
import type { Result } from "../shared/result";
import { allowedOpenUrlSchemes } from "../shared/url";
import { keyCount } from "../shared/device-layout";
import type { VirtualInput } from "../application/ports/core-port";
import {
  initialUIState,
  draftUrlForCurrentTarget,
  markActionDraftChanged,
  markSaveFailed,
  markSaveStarted,
  reduceCoreEvent,
  selectEncoderTarget,
  selectKeyTarget,
  selectPage,
  selectedPage,
  selectedProfile,
  type UIState
} from "./state";
import type { CoreEvent } from "../application/ports/core-port";

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
  const [connection, snapshot] = await Promise.all([context.api.getConnectionStatus(), context.api.getSnapshot()]);
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
          <button data-action="create-profile" title="Create profile">+</button>
        </div>
        <div class="profile-list">
          ${state.snapshot?.profiles.map((item) => profileButton(item.id, item.name, item.active, item.id === state.selectedProfileId)).join("") ?? ""}
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
        <input data-field="profile-name" value="${escapeHtml(selectedProfile(state)?.name ?? "")}" />
      </label>
      <div class="pages" role="tablist">
        ${Array.from({ length: layout.pageCount }, (_, index) => `
          <button data-page="${index}" class="${index === state.selectedPageIndex ? "selected" : ""}">Page ${index + 1}</button>
        `).join("")}
      </div>
    </div>

    <div class="device-area">
      <section class="key-grid" style="grid-template-columns: repeat(${layout.keyColumns}, minmax(96px, 1fr));">
        ${page.keys.map((key) => keyMarkup(key)).join("")}
      </section>

      <section class="encoder-panel">
        <h2>Encoders</h2>
        ${page.encoders.map((encoder) => encoderMarkup(encoder)).join("")}
      </section>
    </div>

    <section class="action-editor">
      ${actionEditorMarkup(state, page)}
    </section>

    <section class="save-state ${state.saveStatus.state}">
      ${saveStatusText(state)}
    </section>

    <footer class="run-state ${state.actionStatus.state}">
      ${actionStatusText(state.actionStatus)}
    </footer>

    <input type="hidden" data-profile-id value="${profileId}" />
  `;
}

function keyMarkup(key: KeyBinding): string {
  const label = key.action?.kind === "open_url" ? key.action.url : "Unassigned";
  return `
    <button class="key-tile" data-key="${key.index}">
      <strong>K${key.index + 1}</strong>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function encoderMarkup(encoder: EncoderBinding): string {
  return `
    <div class="encoder" data-encoder="${encoder.index}">
      <div class="encoder-title">Encoder ${encoder.index + 1}</div>
      ${encoderButton(encoder.index, "rotateLeft", "Left", encoder.rotateLeft?.url)}
      ${encoderButton(encoder.index, "press", "Press", encoder.press?.url)}
      ${encoderButton(encoder.index, "rotateRight", "Right", encoder.rotateRight?.url)}
    </div>
  `;
}

function encoderButton(index: number, control: string, label: string, url?: string): string {
  return `
    <button data-encoder-control="${control}" data-encoder-index="${index}">
      <span>${label}</span>
      <small>${escapeHtml(url ?? "Unassigned")}</small>
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
      <button data-action="save-action">Save</button>
      <button data-action="clear-action">Clear</button>
      <button data-action="simulate-input">Run virtual input</button>
    </div>
    <p class="hint">Allowed schemes: ${allowedOpenUrlSchemes().join(", ")}</p>
  `;
}

function bindEvents(context: RenderContext) {
  context.root.querySelector("[data-action='create-profile']")?.addEventListener("click", async () => {
    const name = window.prompt("Profile name", "New Profile") ?? "";
    if (!name.trim()) return;
    await applySnapshot(context, context.api.createProfile(name));
  });

  context.root.querySelectorAll<HTMLElement>("[data-profile]").forEach((node) => {
    node.addEventListener("click", async () => {
      await applySnapshot(context, context.api.activateProfile(node.dataset.profile!));
    });
  });

  context.root.querySelector("[data-field='profile-name']")?.addEventListener("change", async (event) => {
    const profileId = context.state.selectedProfileId;
    if (!profileId) return;
    await applySnapshot(context, context.api.renameProfile(profileId, (event.target as HTMLInputElement).value));
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
  const profile = selectedProfile(context.state);
  if (!profile) return;
  if (context.state.editingKeyIndex != null) {
    await context.api.sendVirtualInput({
      type: "key",
      profileId: profile.id,
      pageIndex: context.state.selectedPageIndex,
      keyIndex: context.state.editingKeyIndex
    });
  } else if (context.state.editingEncoderIndex != null && context.state.editingEncoderControl) {
    await context.api.sendVirtualInput({
      type: "encoder",
      profileId: profile.id,
      pageIndex: context.state.selectedPageIndex,
      encoderIndex: context.state.editingEncoderIndex,
      interaction: context.state.editingEncoderControl
    });
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

function profileButton(id: string, name: string, active: boolean, selected: boolean): string {
  return `<button data-profile="${id}" class="${selected ? "selected" : ""}">${escapeHtml(name)}${active ? "<span>Active</span>" : ""}</button>`;
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
  if (status.state === "running") return `${status.target}: running`;
  return `${status.target}: ${status.message}`;
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
