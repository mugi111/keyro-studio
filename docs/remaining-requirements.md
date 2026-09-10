# Implementation Status and Remaining Work

Assessed on 2026-09-10 at `c4c2b7a`. Sources: README, application ports,
UI implementation, local IPC adapter, and the existing tests. This is a
repository-derived backlog, not a complete external product specification.

Windows 11 x64 is now the primary acceptance target. See
[Windows acceptance](windows-acceptance.md) for setup, native CI, and the
functional checks that still require a Windows machine.

## Implemented

- Typed Electrobun RPC and separate domain/application/infrastructure/UI layers.
- Variable page, key, and encoder layouts from Core snapshots.
- Profile creation, rename, and activation commands in mock and local IPC modes.
- Single `open_url` assignment editing, clearing, and virtual control input.
- Protocol package 0.3.0 handshake, request correlation, and action events.
- Connection state display, manual disconnect/reconnect, and failed-save drafts.
- HTTP/HTTPS validation and architecture/security regression checks.

Baseline: `bun run check` passes type checking and 90 tests.

## Prioritized Tasks

| ID | Priority | Status | Task and Acceptance Criteria |
| --- | --- | --- | --- |
| UI-01 | P1 | Implemented | After successful profile activation, select that profile in the editor. Clear the previous profile's edit target/draft on a switch, preserve it on failure, and block profile operations while saving and saves/virtual inputs during profile operations. Key and encoder editing regressions pass; general save-completion races remain UI-02. |
| UI-02 | P1 | Open | Associate save completion with its request. `reduceCoreEvent` currently treats every snapshot received during saving as success. Unrelated snapshots must not clear a draft or report a successful save. Cover delayed responses and edits during a pending save. |
| UI-03 | P1 | Open | Preserve input focus/caret while typing URLs. The input handler currently replaces the entire root via `innerHTML`. Verify continuous typing in a real browser, including Core events during editing. |
| IPC-01 | P1 | Implemented; Windows run pending | Ignore old socket events, clear partial frames/execution tracking, settle cancelled connection attempts, and reload Core snapshots on reconnect. Controlled-socket and native Unix transport tests pass; Windows CI runs the named-pipe variant. |
| UI-04 | P1 | Implemented | Display failure statuses returned without an action event. Acknowledgements do not imply execution completion. Disconnect ends an unconfirmed running state and permits retry after reconnect. DOM regression passes. |
| WIN-01 | P1 | Implemented; Windows run pending | Use Core's `\\.\pipe\keyro-core-dev` by default on Windows, preserve explicit overrides, and verify the native named-pipe transport in Windows CI. |
| QA-01 | P2 | Open | Run packaged Electrobun against a real Core process: connect, create/rename/activate, edit/clear key and encoder assignments, restart/reconnect, and check execution events. Current tests use fakes or mock adapters. |
| RELEASE-01 | P2 | Open | Separate development and production CSP. Remove development localhost WebSocket allowance from release assets and verify packaged RPC still works. |

## Requirements Needing Product or Core Coordination

- Multiple actions per assignment: the wire snapshot allows arrays, but Studio
  deliberately rejects more than one action. Decide editing/order semantics
  before extending the domain and UI.
- Profile deletion, duplication, import/export, and additional action kinds are
  not established requirements in the repository. Confirm scope and protocol
  support before scheduling them.
- Automatic reconnect policy and unsaved-change navigation protection need
  product decisions. Existing navigation discards drafts on target changes.

## First Implementation Plan

UI-01 affects `src/ui/state.ts`, `src/ui/dom.ts`, and their existing tests.
Keep the public API and dependency direction unchanged. Apply explicit profile
selection only after successful activation; preserve current selection for
ordinary snapshots and renames. Retain the selected page while clearing the
old control target. Block overlapping save/profile mutations. Add state and DOM
regressions, run `bun run check`, then review the final diff manually.

All passes in this task are performed by the main agent without subagents.
Commit the assessment separately from the implementation and regression tests.

## UI-01 Verification and Handoff

- Completed manual orchestration, architecture, implementation, and final-diff
  self-review. No subagents were used.
- Changed `src/ui/state.ts` and `src/ui/dom.ts`; added four tests and extended
  the existing activation test in `tests/ui.test.ts` and `tests/ui-dom.test.ts`.
- Regression tests reproduced stale profile selection and enabled saves during
  activation before the fix. `bun run check` now passes type checking and all
  94 tests; `git diff --check` passes.
- No BLOCKER or MAJOR finding in the scoped final diff. Previously identified
  save-completion, input-focus, IPC reconnect, and action-result issues remain
  in the backlog above.
- No real Core or native Electrobun session was exercised. Existing navigation
  semantics discard drafts when switching targets, including profiles after
  this fix; a discard-confirmation workflow remains a product decision.

## Windows Implementation Pass

All orchestration, design, implementation and diff-review passes are manual;
no subagents are used. The Core Windows quickstart and `windows_ipc.rs` were
read to confirm the endpoint and protocol. OS selection remains in main
infrastructure, and UI communicates only through the existing typed API.

Commits separate endpoint/reconnect changes, execution-state handling, and
Windows CI/documentation. Real Windows UI acceptance and production packaging
are not marked complete by passing host tests.

Host verification: `bun run check` passed type checking and 100 tests across
10 files, including real Unix IPC; `bun run build` completed the macOS
development build without signing/notarization. Workflow YAML parsing and
`git diff --check` passed. Final-diff self-review found no BLOCKER or MAJOR
issues in these changes. Windows CI has been added but not executed here.
