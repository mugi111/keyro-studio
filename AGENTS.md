# Keyro Studio Agent Guide

This repository uses global Codex custom agents in `~/.codex/agents`.
Choose the smallest agent workflow that fits the task.

If custom agents are not available, treat the agent names below as human or
single-agent working modes. Follow the same responsibilities, permissions, and
handoff expectations manually.

## Required Workflow

For non-trivial implementation tasks, follow this workflow in order. A task is
non-trivial when it changes runtime behavior, architecture, public contracts,
security posture, persistence, build configuration, or more than one layer.
When a task might be non-trivial, run the Orchestrator Pass first to classify
and route the work before deciding which later phases are needed.

Do not skip a phase just because the next step looks obvious. If a phase is not
applicable, record why in the handoff.

### 1. Orchestrator Pass

Use the `orchestrator` custom agent when available for task breakdown,
workflow routing, sequencing, and handoff management.

- Clarify the goal, success criteria, constraints, and open questions.
- Decide whether the task is trivial or non-trivial.
- Split non-trivial work into appropriate architect, implementer, and reviewer
  phases.
- Identify which files, layers, or responsibilities each phase should cover.
- Track dependency order, parallelizable work, risks, and expected verification.
- Do not modify files during this pass.
- If product intent, ownership, or priority is ambiguous, stop and ask before
  assigning implementation work.

### 2. Architect Pass

Use the `architect` custom agent when available. If custom agents are not
available, perform this pass manually before editing files.

- Read the relevant code, tests, configuration, and existing architecture notes.
- Identify affected layers and confirm the dependency direction will remain:
  `shared <- domain <- application <- infrastructure / ui`.
- Write a short implementation plan covering approach, affected files, risks,
  tests, and commit boundaries.
- Do not modify files during this pass.
- If the design is ambiguous or requires a product decision, stop and ask before
  implementing.

### 3. Implementer Pass

Use the `implementer` custom agent when available. If custom agents are not
available, treat this as a separate implementation phase after the architecture
pass is complete.

- Implement only the approved or clearly stated plan.
- Keep changes focused to the task and preserve existing APIs unless the task
  requires changing them.
- Add or update tests at the closest layer to the behavior being changed.
- Keep business rules out of Electrobun/UI-specific code.
- Make commits at meaningful boundaries, such as foundation, domain/application,
  adapter/RPC, UI, tests, or security.
- Run the relevant verification commands before entering the review pass.

### 4. Reviewer Pass

Use the `reviewer` custom agent when available. If custom agents are not
available, use a separate human reviewer when possible. If no separate reviewer
is available, perform a distinct self-review after stepping away from the
implementation context.

- Review the final diff, not just the final files.
- Check requirements, dependency direction, public contracts, security rules,
  test coverage, maintainability, and regression risk.
- Classify findings as `BLOCKER`, `MAJOR`, `MINOR`, or `NIT`.
- Fix all `BLOCKER` and `MAJOR` findings before handoff.
- If only `MINOR` or `NIT` findings remain, mention them in the handoff.

### 5. Handoff

Before final handoff, report:

- Which workflow phases were completed and whether custom agents or manual
  passes were used.
- Changed files and a concise change summary.
- Tests added or updated.
- Verification commands and results.
- Remaining risks or skipped phases, if any.

## Custom Agents

### Orchestrator

Use `orchestrator` for task intake, task decomposition, workflow routing,
sequencing, coordination across agents, and final handoff readiness.

Without the custom agent, perform a manual orchestration pass before deciding
which specialist phases are needed.

- Confirm goal, constraints, success criteria, and ambiguity.
- Choose the smallest workflow that safely fits the task.
- Break work into clear phases and ownership boundaries.
- Decide when architect, implementer, and reviewer passes are required.
- Track handoff requirements, verification expectations, and unresolved risks.
- Do not modify files.
- Do not make detailed architecture decisions that belong to the architect.
- Do not implement code or perform final code review.

### Architect

Use `architect` for requirements analysis, feature design, domain modeling,
API contract changes, or any task where the implementation approach is not yet
settled.

Without the custom agent, do an architecture pass first and write the design
notes before implementation begins.

- Read the existing code before proposing changes.
- Do not modify files.
- Produce a design another engineer can implement without revisiting major
  architecture decisions.
- Call out affected files, risks, and implementation order.

### Implementer

Use `implementer` for approved, concrete code changes.

Without the custom agent, switch into implementation mode only after the design
is clear enough to execute.

- Read nearby code and tests before editing.
- Keep changes focused and avoid speculative abstractions.
- Preserve existing APIs unless the requested behavior requires a change.
- Add or update tests when behavior changes.
- Stop and explain if the design requires an architectural decision first.

### Reviewer

Use `reviewer` for independent review before merge or after non-trivial edits.

Without the custom agent, have a person other than the implementer review when
possible. If that is not possible, do a separate self-review pass after a short
context reset.

- Do not modify files.
- Review requirements, architecture, conventions, tests, maintainability, and
  regression risk.
- Prioritize meaningful correctness and design issues over style preferences.
- Classify findings as `BLOCKER`, `MAJOR`, `MINOR`, or `NIT`.

## Repository Architecture

Keyro Studio is an Electrobun + TypeScript desktop configuration app for Keyro
Core. The current MVP uses a mock Core adapter because the external protocol is
not defined yet.

Dependencies flow in one direction:

```text
shared <- domain <- application <- infrastructure / ui
```

- `src/shared`: common `Result` helpers, URL validation, and device layout
  types.
- `src/domain`: pure profile, page, key, encoder, and action rules.
- `src/application`: use cases and Core port abstractions.
- `src/infrastructure/main`: Electrobun entrypoint, typed RPC contracts,
  handlers, and mock Core adapter.
- `src/ui`: browser-side state and rendering. UI communicates with main through
  typed RPC only.

Keep business rules in `domain` or `application`. Keep Electrobun, OS, process,
and adapter details in `infrastructure/main`. Browser UI code must not import
Bun, Node, filesystem, pipe, socket, or OS APIs.

## Development Rules

- TypeScript is strict; keep `noUncheckedIndexedAccess` constraints in mind.
- Prefer existing `Result` patterns over throwing for expected validation
  failures.
- URL actions must allow only `http` and `https`.
- Device layout is variable; do not hard-code key, encoder, or page counts when
  layout data is available.
- Main-browser communication must stay covered by typed RPC contracts.
- SQLite is intentionally not accessed by this app; Core is the source of
  state.
- Avoid broad refactors unless the requested change requires them.

## Commands

Run these from the repository root:

```bash
bun install
bun run typecheck
bun test
bun run check
bun run dev
```

Use `bun run check` before handing off completed code changes when feasible.

## Testing Expectations

- Domain rule changes should have focused tests in `tests/domain.test.ts`.
- Application behavior changes should update `tests/application.test.ts`.
- RPC, adapter, or infrastructure behavior should update the relevant
  integration-style tests.
- Security-sensitive changes should update `tests/security.test.ts`.
- UI behavior changes should update `tests/ui.test.ts` or add coverage at the
  nearest existing test layer.

## Handoff Expectations

For implementation work, report:

- Changed files
- What changed
- Tests added or updated
- Verification commands and results
- Remaining concerns, if any

For reviews, lead with findings ordered by severity and include precise file
and line references.
