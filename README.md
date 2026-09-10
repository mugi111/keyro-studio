# Keyro Studio

Keyro Studio is a desktop configuration app for Keyro Core. This repository currently implements the first MVP as an Electrobun + TypeScript app with a Mock Core Adapter while the external `@mugi111/keyro-protocol` package is consumed as the Core/Studio/Device contract source of truth.

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

Windows 11 x64 is the primary acceptance target. See [Windows startup and acceptance](docs/windows-acceptance.md) for PowerShell commands and the functional checklist.

Set `KEYRO_STUDIO_CORE_MODE=local-ipc` to connect Studio to Keyro Core. The default endpoint on Windows is `\\.\pipe\keyro-core-dev`; on macOS it is `~/Library/Application Support/Keyro/Core/keyro-core-dev.sock`; on Linux it is `~/.local/share/keyro/core/keyro-core-dev.sock`. Set `KEYRO_STUDIO_CORE_SOCKET` to override the endpoint. The default mode is `mock`. Reconnect refreshes the snapshot from Core.

The local IPC adapter uses the Core protocol v0.3 snapshot as Studio's authoritative source for device layout, profiles, and assignments. It supports profile creation, profile rename, active profile switching, single-assignment saves, assignment clearing, virtual control input, and Core action events.

Set `KEYRO_STUDIO_ACTION_EXECUTOR=os-open-url` to execute validated `open_url` actions through the OS default browser. The default action executor is `mock`, so simulator clicks do not open browser windows unless explicitly enabled.

## Product Integration

- `@mugi111/keyro-protocol` is the only intended source of truth for Core/Studio/Device wire contracts.
- Studio must consume a tagged protocol package version, not a moving `main` branch or copied Core-local files.
- Domain and application models stay independent from protocol DTOs; conversion belongs in infrastructure adapters.
- Core/Studio handshakes exchange component and protocol versions before normal requests.
- Core/Studio protocol `0.x` requires an exact `{major, minor}` match during handshake. Later stable protocol versions can loosen compatibility only after the shared contract defines that policy.

## Security Notes

- The browser view loads bundled `views://` assets, not remote web content.
- Browser code does not import Bun, Node, filesystem, pipe, socket, or OS APIs.
- Main-Browser communication uses Electrobun typed RPC.
- The primary local Studio view is intentionally non-sandboxed because Electrobun disables the typed RPC bridge for sandboxed windows; capability is constrained through local-only navigation, CSP, and a minimal typed API.
- CSP currently allows `ws://localhost:*` only to support Electrobun development tooling. Production packaging must remove that allowance once the build pipeline can inject environment-specific CSP.
- URL actions allow only `http` and `https`.
- SQLite is intentionally not accessed; Core is the state source.
