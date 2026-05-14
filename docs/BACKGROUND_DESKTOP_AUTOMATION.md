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

## Next Steps

- Add a persistent Hyper-V worker profile for real apps and saved login state.
- Add screenshot image injection for `desktop_background_command(action=screenshot)`.
- Add named windows, accessibility tree, and OCR inside the worker.
- Add a target selector so normal `desktop_*` calls can route to `host`,
  `sandbox`, or a configured `worker_url`.
