# Keyro Studio

Keyro Studio is a desktop configuration app for Keyro Core. This repository currently implements the first MVP as an Electrobun + TypeScript app with a Mock Core Adapter while the external `@keyro/protocol` package is being split out as the Core/Studio/Device contract source of truth.

## Architecture

Dependencies flow in one direction:

```text
shared <- domain <- application <- infrastructure / ui
```

- `shared` contains common results, URL validation, and variable device layout types.
- `domain` contains pure Profile, Page, Key, Encoder, and Action rules.
- `application` contains use cases and Core ports.
- `infrastructure/main` contains Electrobun, typed RPC, and Mock Core.
- `ui` contains browser-side state and rendering that talks only through typed RPC.

## Commands

```bash
bun install
bun run check
bun run dev
```

Set `KEYRO_STUDIO_CORE_MODE=local-ipc` to exercise the future Core IPC adapter boundary. Until `@keyro/protocol` publishes generated TypeScript types, schemas, and test vectors, that mode intentionally reports Core as unavailable. The default mode is `mock`.

Set `KEYRO_STUDIO_ACTION_EXECUTOR=os-open-url` to execute validated `open_url` actions through the OS default browser. The default action executor is `mock`, so simulator clicks do not open browser windows unless explicitly enabled.

## Product Integration

- `@keyro/protocol` is the only intended source of truth for Core/Studio/Device wire contracts.
- Studio must consume a tagged protocol package version, not a moving `main` branch or copied Core-local files.
- Domain and application models stay independent from protocol DTOs; conversion belongs in infrastructure adapters.
- Core/Studio handshakes exchange component and protocol versions before normal requests.
- Core/Studio connections reject different protocol majors. Minor additions within the same major are intended to remain backward compatible; removals, type changes, and semantic changes require a new major.

## Security Notes

- The browser view loads bundled `views://` assets, not remote web content.
- Browser code does not import Bun, Node, filesystem, pipe, socket, or OS APIs.
- Main-Browser communication uses Electrobun typed RPC.
- The primary local Studio view is intentionally non-sandboxed because Electrobun disables the typed RPC bridge for sandboxed windows; capability is constrained through local-only navigation, CSP, and a minimal typed API.
- CSP currently allows `ws://localhost:*` only to support Electrobun development tooling. Production packaging must remove that allowance once the build pipeline can inject environment-specific CSP.
- URL actions allow only `http` and `https`.
- SQLite is intentionally not accessed; Core is the state source.
