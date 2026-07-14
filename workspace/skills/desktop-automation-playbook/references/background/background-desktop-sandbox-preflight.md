# Background Desktop Sandbox Preflight — 2026-05-12

Evidence: two the user-requested desktop sandbox tests on 2026-05-12 (`Brain/skill-episodes/2026-05-12/episodes.jsonl:1-2`; `audit/chats/transcripts/telegram_1799053599_1778556678895.md:76-105`; `audit/chats/transcripts/2fea98cc-1540-4391-b0bd-a3bc3cfaa389.md:1-49`).

## What happened

Foreground desktop tools worked: monitors, process/window listing, screenshots, window screenshots, find window, and native window control. The non-disruptive/background desktop lane was not operational on this machine: `desktop_background_status` reported host tools as foreground-only, Windows Sandbox/Hyper-V/VMMS unavailable, RDP stopped, and no external worker URL. `desktop_background_command({ action: "screenshot" })` queued commands but timed out because no sandbox/VM/external worker responded.

The run also showed runtime/tool mismatch: these tool names were attempted or expected but returned unknown in that session: `desktop_get_window_text`, `desktop_get_accessibility_tree`, and `desktop_list_macros`. Treat those as optional/runtime-dependent even if older playbook text mentions them.

## Guardrail for future sandbox tests

When the user asks whether desktop tools are sandboxed/non-disruptive, start with capability/status, not worker commands:

1. Read this playbook.
2. Call `desktop_background_status` first.
3. If status says host tools are foreground-only and no Windows Sandbox/Hyper-V/external worker is available, report that clearly and do **not** queue repeated `desktop_background_command` screenshots.
4. Use `desktop_background_prepare_sandbox({ launch:false })` only to verify generated config/worker paths; use `launch:true` only if the status says a sandbox target is plausible or the user explicitly wants a launch attempt.
5. Avoid policy-blocked shell diagnostics for Windows feature checks unless shell execution is already approved. Prefer the status tool’s Windows Sandbox/Hyper-V/VMMS/external-worker fields.
6. If normal foreground desktop tools must be tested, warn/confirm in the result that they can still move focus/click/type on the user's real desktop.

## Reporting shape

Use a concise split:

- **Foreground desktop:** what works.
- **Background/non-disruptive lane:** worker/sandbox/VM/external status.
- **Current blocker:** exact missing target, e.g. Windows Sandbox/Hyper-V/external worker.
- **Next fix:** enable/install a supported isolated target or configure an external desktop worker URL.

Do not claim Prometheus has non-disruptive desktop control until a real background worker responds and a screenshot/action is verified from the isolated surface.
