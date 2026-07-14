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

