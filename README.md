# Keyro Studio

Keyro Studio is a desktop configuration app for Keyro Core. This repository currently implements the first MVP as an Electrobun + TypeScript app with a Mock Core Adapter because the external protocol is not defined yet.

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

Set `KEYRO_STUDIO_CORE_MODE=local-ipc` to exercise the future Core IPC adapter boundary. Until `keyro-protocol` is defined, that mode intentionally reports Core as unavailable. The default mode is `mock`.

## Security Notes

- The browser view loads bundled `views://` assets, not remote web content.
- Browser code does not import Bun, Node, filesystem, pipe, socket, or OS APIs.
- Main-Browser communication uses Electrobun typed RPC.
- URL actions allow only `http` and `https`.
- SQLite is intentionally not accessed; Core is the state source.
