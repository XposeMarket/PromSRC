# Background Desktop Automation

Prometheus now treats desktop automation as two different targets:

1. **Host desktop tools** (`desktop_screenshot`, `desktop_click`, `desktop_type`, etc.)
   operate on the current Windows input desktop. They are useful when the user
   explicitly wants Prometheus to control the visible machine, but clicks and
   keys can interrupt the user.
2. **Background desktop tools** (`desktop_background_*`) target an isolated
   worker desktop through a bridge. The first supported target is Windows
   Sandbox; the same bridge can later be reused for Hyper-V, RDP, or cloud VMs.

## Why Browser Tools Can Stay In The Background

Browser automation is isolated because Playwright/CDP controls a browser
runtime directly. It can use a separate Chrome profile, a separate page, and
remote debugging commands instead of moving the host mouse.

Native desktop automation is different. Windows mouse/keyboard primitives work
against the active input desktop. A hidden or alternate desktop object is not a
complete substitute for a second usable workstation unless it is made visible
or remoted as its own session.

## Viable Architecture

The robust implementation is a second interactive OS environment:

- Windows Sandbox for ephemeral, clean tasks.
- Hyper-V or another VM for persistent installed apps and logins.
- Windows Server RDS / Azure Virtual Desktop for true multi-session desktops.
- A remote/cloud Windows VM for long-running unattended work.

Prometheus talks to that environment through a small worker. The worker captures
screenshots and injects input inside its own session, while the host Prometheus
process sends commands over an HTTP, WebSocket, or file bridge.

## Current MVP

The MVP is a Windows Sandbox folder bridge:

- `desktop_background_status` reports host readiness and the bridge path.
- `desktop_background_prepare_sandbox` writes:
  - `.prometheus/desktop-background/prometheus-background-desktop.wsb`
  - `.prometheus/desktop-background/bridge/worker.ps1`
  - inbox/outbox/screenshot bridge folders
- `desktop_background_command` sends one command to the worker and waits for a
  result.

Supported bridge actions:

- `screenshot`
- `click`
- `type`
- `key`
- `run`
- `wait`

Example flow:

```text
desktop_background_status()
desktop_background_prepare_sandbox({ "launch": true })
desktop_background_command({ "action": "screenshot", "timeout_ms": 30000 })
desktop_background_command({ "action": "run", "command": "start notepad" })
desktop_background_command({ "action": "type", "text": "Hello from Prometheus" })
```

## Canonical Window Model (host)

The host desktop layer now exposes a Codex-style canonical app/window/state
model on top of the existing PowerShell internals:

- `desktop_list_apps` — installed + running apps; running apps first, each with
  open windows (`window_id`, `handle`, `bounds`, `is_active`) and a stable
  `app_id`.
- `desktop_list_windows` — flat window list with `window_id` (= `win_<HWND>`),
  `app_id`, `process_name`, `title`, `bounds`, `monitor_index`, `is_active`.
- `desktop_get_window_state` — point-in-time snapshot of one window: metadata,
  an optional screenshot (with a reusable `screenshot_id`), and optional
  accessibility text. Resolve the window by `window_id` (preferred),
  `window_handle`, `app_id`, or `title`.

Window-scoped input tools resolve an exact window (restoring + focusing it)
before acting, with coordinates defaulting to **window-space**:

- `desktop_window_click`, `desktop_window_type`, `desktop_window_press_key`,
  `desktop_window_scroll`, `desktop_window_drag`.

These wrap the existing primitives, so the older `desktop_click` / `desktop_type`
coordinate tools remain available and unchanged.

### Capture backend

`resolveDesktopCaptureBackend()` selects the capture path and is reported by
`desktop_doctor`. The env var `PROMETHEUS_DESKTOP_CAPTURE_BACKEND` accepts
`auto` (default), `graphics_capture`, or `copy_from_screen`. Today all values
resolve to the stable `copy_from_screen` path; the
`graphics_capture` value is reserved for a future Windows.Graphics.Capture
native helper that can capture occluded windows.

### Confirmation taxonomy

`src/gateway/ui-action-policy.ts` ports the Codex confirmation taxonomy
(`evaluateUiActionRisk`) into a shared, tested decision point for both desktop
and browser UI actions (allow / confirm / handoff / deny). Final-action gating
remains enforced by the tool layer via `request_final_action_approval` +
`consumeFinalActionApproval`.

### Registry parity

All three desktop tool surfaces — `getDesktopToolDefinitions()` (model-facing),
the chat/subagent dispatch in `subagent-executor.ts`, and the `allDesktopTools`
ToolRegistry wrappers in `src/tools/desktop.ts` — are kept in sync by
`scripts/test-desktop-registry-parity.mjs` (run after `npm run build:backend`).

## Next Steps

- **Native Windows.Graphics.Capture helper** so `graphics_capture` can capture
  occluded windows per-window (currently falls back to `copy_from_screen`).
- **Background worker parity (Phase 6):** add `list_windows`, `get_window_state`,
  `get_accessibility_tree`, and window-scoped `window_click` / `window_type` /
  `window_key` to the sandbox worker, and return screenshots as base64.
- Add a persistent Hyper-V worker profile for real apps and saved login state.
- Add a target selector so normal `desktop_*` calls can route to `host`,
  `sandbox`, or a configured `worker_url`.
