# Prometheus Vita


## v00.24 session persistence

- Vita-created chats now use `mobile_vita_...` IDs, so Prometheus classifies and persists them as mobile sessions.
- The SESSIONS tab refreshes from the gateway every time it is opened, making newly completed Vita chats immediately available.
- Session IDs include the RTC date/time plus process time to remain unique across app relaunches.
- Triangle now opens Vita settings for provider, model, reasoning effort, PC bridge address, and optional bridge token; model settings are applied through Prometheus and persist locally.

## v00.23 UI and streaming

- Three real tabs: CHAT, SESSIONS, and SUBAGENTS.
- CHAT creates/continues a gateway-backed session; SESSIONS lists prior mobile sessions and opens one back into CHAT.
- SUBAGENTS stays a roster until X opens a selected agent's direct chat.
- Main-chat SSE is streamed through the PC bridge so the Vita status bar shows the current tool/activity before the final reply.
- Message rows show local HH:MM timestamps.
- Front touchscreen vertical swipes scroll chat history; D-pad scrolling remains available.
- Images and voice remain follow-up work: image rendering needs a Vita texture/download cache; native voice needs microphone capture/encoding plus the existing voice-agent route.


Separate from Figure 8 Drift. This project contains a native PS Vita Prometheus client and a PC-side screen-view bridge.

## Components

- `vita-client/`: native VitaSDK VPK (`PROMVITA1`) with Vita IME input, persistent gateway/token settings, `/api/chat` SSE support, and gateway-persisted `mobile_vita_...` chat sessions.
- `pc-bridge/`: local Node services for UVC frame capture, authenticated Vita input control, and Wi-Fi VPK update delivery.
- `input-plugin/`: kernel plugin that receives checksummed UDP controller packets and injects Vita buttons/sticks.
- `vendor/vita-udcd-uvc/`: upstream USB Video Class plugin source.
- `deploy/`: ready-to-copy VPK and official upstream v1.7 `udcd_uvc.skprx`.

## Build

```powershell
C:\msys64\usr\bin\bash.exe games/prometheus-vita/vita-client/build-vita.sh
C:\msys64\usr\bin\bash.exe games/prometheus-vita/input-plugin/build-vita.sh
cd games/prometheus-vita/pc-bridge
node --test
```

## Vita client

1. Copy `vita-client/build/prometheus_vita.vpk` to `ux0:downloads/` and install with VitaShell.
2. Launch **Prometheus**.
3. The Vita connects to the LAN bridge at `http://10.0.0.125:8780`. The bridge proxies requests safely to the localhost-only Prometheus gateway at `127.0.0.1:18789`; no mobile pairing token is needed by default. Old `:8884`/`:8789` settings migrate automatically. Press **Triangle** to edit the bridge address if the PC IP changes.
4. Use **L/R** to switch among **CHAT**, **SESSIONS**, and **SUBAGENTS**.
5. **SESSIONS** refreshes the real mobile-session library whenever opened. Press **Square** outside SUBAGENTS to create a new gateway-backed chat; completed Vita chats remain available after app relaunch.
6. **SUBAGENTS** loads the live configured agent roster from `/api/agents`. Use **Up/Down** at the top/bottom of chat to select an agent, **X** to chat through `/api/agents/:id/chat`, and **Square** to refresh roster/history.
7. Press **X** to open Vita IME and send a message. Use **Up/Down** to scroll wrapped chat history. Press **Start** to exit.

Settings persist in `ux0:data/prometheus-vita/settings.txt`. If no standalone subagents are configured, the Subagents page says so instead of fabricating entries.

### Wi-Fi app updates

Run `node pc-bridge/server.mjs` on the PC with the latest VPK at `deploy/prometheus_vita.vpk`. In the Vita app, press **Circle** to download that VPK over Wi-Fi to `ux0:data/prometheus-vita/prometheus_vita_update.vpk`. Exit Prometheus, open VitaShell, install the downloaded VPK, and relaunch Prometheus. This replaces the user-mode app and does **not** require a Vita reboot. Only kernel-plugin changes require rebooting.

## USB screen viewing

1. Copy `deploy/udcd_uvc.skprx` to the active tai directory.
2. Back up the active `config.txt`, then add `ur0:tai/udcd_uvc.skprx` under the existing `*KERNEL` section. If this Vita uses `ux0:tai` as its active config, use that path instead.
3. Reboot. Holding **L** during boot bypasses plugin loading for recovery.
4. Connect USB. Windows exposes the Vita as a UVC camera at up to 960x544.
5. Install/provide FFmpeg and set `VITA_VIDEO_DEVICE` to the DirectShow camera name, then run `node pc-bridge/server.mjs`.
6. Prometheus can fetch a new frame using `POST /capture`, then read `GET /frame.jpg`.

## Remote input control

The custom `prometheus_vita_input.skprx` complements UVC with programmatic Vita button/stick injection over LAN.

1. Copy `deploy/prometheus_vita_input.skprx` to `ur0:tai/`.
2. Add `ur0:tai/prometheus_vita_input.skprx` under `*KERNEL`, after `udcd_uvc.skprx`, then reboot. Hold **L** while booting to bypass plugins if recovery is needed.
3. Start the Windows controller service with the Vita LAN IP:

```powershell
$env:VITA_IP = "<VITA-IP>"
node games/prometheus-vita/pc-bridge/control-server.mjs
```

4. Test one button press:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/tap -Method Post -ContentType 'application/json' -Body '{"button":"right"}'
```

Supported names: `up`, `right`, `down`, `left`, `cross`, `circle`, `square`, `triangle`, `l`, `r`, `start`, `select`, and `ps`. `POST /state` accepts the same `press` array plus `lx`, `ly`, `rx`, and `ry` values from 0-255. Set `VITA_CONTROL_TOKEN` to require `X-Vita-Control-Token` on control requests.

Protocol v2 packets include a magic value, version, sequence number, and FNV-1a checksum. Unknown, malformed, stale, or corrupt packets are ignored. Every accepted packet returns a checksummed UDP acknowledgement containing the sequence and the raw button/analog emulation return codes, so the PC can distinguish network delivery from injection failure. Input emulation expires automatically within a few controller samples if packets stop.

## Wireless plugin updates

USB is not required for routine file transfer. In VitaShell, press **Start**, set **SELECT button** to **FTP**, close the menu, then press **Select**. VitaShell displays an address such as `ftp://10.0.0.231:1337`. While that FTP screen remains open, the PC can upload `deploy/prometheus_vita_input.skprx` directly over Wi-Fi. Because the active plugin is in `ur0:tai`, reboot after replacing it. Keep USB only for the UVC live-camera feed.


`pc-bridge` binds to port 8789 by default. Set `VITA_BRIDGE_TOKEN` to require `X-Vita-Bridge-Token` or `?token=` authentication.

## Current hardware deployment

- `D:\downloads\prometheus_vita.vpk` copied and visually verified.
- `D:\tai\udcd_uvc.skprx` copied and visually verified.
- The VPK still must be installed from VitaShell.
- The plugin entry still must be added to the Vita's active tai config and the Vita rebooted. Those are intentionally not performed blindly because the mounted USB view exposes `ux0:tai`, while the active Enso config may be `ur0:tai/config.txt`.
# Figure 8 game development workflow

When using this bridge to work on Figure 8 Drift, also read
[`../figure-8-drift-vita/PROMETHEUS_WORKFLOW.md`](../figure-8-drift-vita/PROMETHEUS_WORKFLOW.md).
It documents the local Windows geometry preview, structural layout validation,
Vita build, backend install, and hardware smoke-test loop.
