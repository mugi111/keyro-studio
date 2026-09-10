# Windows Development and Acceptance

Target: Windows 11 x64, with Studio and Core running as the same ordinary user.
Use Bun 1.3.11 and the system WebView2 runtime (`build.win.bundleCEF` is false).
Core must implement protocol 0.3 and its Windows development named-pipe server.

## Start

Build and start `keyro-core.exe` using Core's `WINDOWS_QUICKSTART.md`. Keep Core
running. From this Studio repository in a second PowerShell terminal:

```powershell
bun install --frozen-lockfile
bun run check
$env:KEYRO_STUDIO_CORE_MODE = 'local-ipc'
bun run dev
```

Studio automatically uses `\\.\pipe\keyro-core-dev` on Windows. To override
the endpoint for a Core instance that listens on a different local pipe:

```powershell
$env:KEYRO_STUDIO_CORE_SOCKET = '\\.\pipe\your-core-pipe'
```

The default mode remains `mock`. For an explicit mock-only session:

```powershell
$env:KEYRO_STUDIO_CORE_MODE = 'mock'
$env:KEYRO_STUDIO_ACTION_EXECUTOR = 'os-open-url'
bun run dev
```

`os-open-url` enables real browser launch only for Studio's mock adapter. In
`local-ipc` mode Core executes actions; Studio only sends virtual inputs.
Studio does not read or write Core's database. The fixed development pipe is
owned by Core and currently supports one Core account per machine.

## Automated Verification

`bun run check` includes a real `node:net` IPC server/client exchange. It uses a
unique Windows named pipe on Windows and a temporary Unix socket on macOS/Linux.
It checks the 0.3 handshake, snapshot layout, and reconnect snapshot events.
Separate controlled-socket tests cover late close/error/data events, cancelled
connection attempts, and unavailable Core retries.

The Windows Studio workflow runs type checking, all tests, and `bun run build`
on a native Windows runner. Its artifact is a development application, not a
signed production installer. Production CSP and release packaging remain open.

## Windows UI Acceptance

Record the Core revision, Studio revision, Windows version, and results when
performing these checks. Native IPC CI does not replace this checklist.

| Requirement | Procedure and Expected Result | Status |
| --- | --- | --- |
| Connection | Start Core then Studio. Connected appears; four pages, 12 keys and two encoders appear for the default Core layout. | Pending Windows run |
| Profiles | Create, rename, and activate a second profile. Its name and assignments appear in the editor. | Pending Windows run |
| Keys | On all four pages save a different HTTPS URL and reload/reconnect; assignments remain associated with their profile/page/key. Clear one and confirm it stays unassigned. | Pending Windows run |
| Encoders | Save, run, and clear left/right/press on each encoder on multiple pages. Core receives the matching control. | Pending Windows run |
| Execution | Run an assigned HTTPS action. The default browser opens; running then success appears. An unassigned action or failed request displays failure and allows retry. | Pending Windows run |
| Validation | A `file:`, `javascript:`, or shell-style URL is rejected and no program launches. | Pending Windows run |
| Recovery | Stop Core while editing/running. No unsaved edit is reported as saved. Restart Core and click Reconnect; latest settings appear and virtual input can run again. | Pending Windows run; save correlation remains UI-02 |
| Lifecycle | Close Studio using the window close button. Studio processes exit, Core stays available. Reopen Studio and verify settings. | Pending Windows run |
| Input | Type/paste a full URL continuously, including with Japanese IME. Focus and caret remain usable during Core events. | Pending Windows run; UI-03 remains open |

## Evidence and Limits

The implementation and tests were checked on macOS. Windows CI, Windows UI,
real Core persistence, and default-browser launch have not been recorded as
passing. See `remaining-requirements.md` for unresolved UI and release work.

Transport reference: [Node IPC documentation](https://nodejs.org/api/net.html#ipc-support).
Build reference: [Electrobun build configuration](https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/).
