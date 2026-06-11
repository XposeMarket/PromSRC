
### [DEBUG] 2026-06-11T19:43:10.693Z
_Source: Main chat session; session: 6253627f-291e-49a0-82fb-9df0ff608233_
Desktop tools test on macOS: desktop_doctor/monitors/list_windows/screenshot/window_state mostly worked. desktop_get_window_text failed with `spawn powershell.exe ENOENT` on macOS. app_id launch for Calculator failed, raw `/System/Applications/Calculator.app` launched but reported no matching window before find_window found handle 7771. User steered: click visible desktop buttons instead of press_key unless using shortcuts, and avoid unnecessary modifiers.
