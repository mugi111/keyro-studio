# Implementation Status and Remaining Work

Assessed on 2026-09-10 at `c4c2b7a`. Sources: README, application ports,
UI implementation, local IPC adapter, and the existing tests. This is a
repository-derived backlog, not a complete external product specification.

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
| UI-01 | P1 | Planned | After successful profile activation, select that profile in the editor. Clear the previous profile's edit target/draft on a switch, preserve it on failure, and prevent save/profile-operation overlap. Verify key and encoder editing against the selected profile. |
| UI-02 | P1 | Open | Associate save completion with its request. `reduceCoreEvent` currently treats every snapshot received during saving as success. Unrelated snapshots must not clear a draft or report a successful save. Cover delayed responses and edits during a pending save. |
| UI-03 | P1 | Open | Preserve input focus/caret while typing URLs. The input handler currently replaces the entire root via `innerHTML`. Verify continuous typing in a real browser, including Core events during editing. |
| IPC-01 | P1 | Open | Isolate reconnect sessions. Old socket callbacks currently share socket, buffer, and pending-request state. Cover delayed old-socket close/data events and partial frames across reconnects. |
| UI-04 | P1 | Open | Handle virtual-input request failures returned as successful `Result` values containing failure status. The UI currently only consumes failed `Result` values or pushed action events. Verify failed requests leave running state without treating acknowledgement as completed execution. |
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
