# Prometheus Windows desktop helper

This persistent native process provides occlusion-safe per-window screenshots
through `Windows.Graphics.Capture`. Prometheus talks to it over newline-delimited
JSON-RPC 2.0 and automatically falls back to the existing `CopyFromScreen` path
when the binary is absent or capture fails.

Requirements:

- Windows 10 version 1903 or newer
- Visual Studio 2022 Build Tools with Desktop C++ and a Windows 10/11 SDK
- CMake 3.24+

Build from a Developer PowerShell:

```powershell
cmake -S native/desktop-helper-windows -B native/desktop-helper-windows/build -A x64
cmake --build native/desktop-helper-windows/build --config Release
Copy-Item native/desktop-helper-windows/build/Release/prometheus-desktop-helper.exe bin/
```

Override discovery with `PROMETHEUS_DESKTOP_WINDOWS_HELPER_PATH`. The helper
currently implements `ping` and `capture` for `{ "kind": "window", "handle":
<HWND> }`; the transport is intentionally compatible with the macOS helper.

The repository does not check in a generated executable. Release packaging
should build/sign the helper and place it in `bin/prometheus-desktop-helper.exe`.

## One-shot administrator commands

The same binary provides an `--elevated-broker` mode used only after the existing
Prometheus approval card resolves an `elevated_command` request. Prometheus uses
Windows `runas` once to copy the helper into a protected ProgramData directory
and register a per-user, highest-privilege Scheduled Task. Later approved
administrator commands use an ACL-protected named pipe and do not show UAC.

The broker checks the connecting executable and independently verifies that the
client process owns the configured Prometheus gateway port. This keeps the dev
gateway safe even though both it and agent-spawned scripts may use `node.exe`.
Each command request remains SHA-256 bound, output-captured, and time-bounded.

Elevated commands cannot be background processes, cannot create session or
always permission grants, and cannot be auto-approved by Lite terminal mode,
goals, schedules, subagents, or trusted-command grants.
