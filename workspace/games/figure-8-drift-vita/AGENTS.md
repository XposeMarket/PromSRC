# Figure 8 Drift — Vita Hardware Runbook

Use this runbook whenever working on this PS Vita game. The paired system-control project is `../prometheus-vita/`. It provides system-wide Wi-Fi input, screen viewing, file delivery, and direct game installation.

## Known hardware and paths

- Vita LAN IP: `10.0.0.231` (verify it after a DHCP/network change).
- PC control service: `http://127.0.0.1:8790`.
- System input UDP: Vita port `18791`.
- System frame/upload TCP+UDP: port `18790`.
- Game-specific bridge: UDP `18792`/`18793`; it is separate from system control.
- Game title ID: `FIG8VITA1`.
- Game VPK: `build-v04/figure8_vita.vpk`.
- Active Vita plugins:
  - `ur0:tai/prometheus_vita_input.skprx` under `*KERNEL`.
  - `ur0:tai/prometheus_vita_control.suprx` under `*main`.
- Recovery: hold **L during boot** to bypass taiHEN plugin loading.

Do not assume `ux0:tai` is active. This Vita uses `ur0:tai`. Never overwrite `config.txt` blindly; preserve its existing sections and entries.

## Start and verify system-wide Wi-Fi control

From the repository root in PowerShell:

```powershell
$env:VITA_IP='10.0.0.231'
node workspace/games/prometheus-vita/pc-bridge/control-server.mjs
```

Keep that process running. Verify it:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/health
```

While this service is running it sends a non-input heartbeat every three seconds. The SceShell companion resets the Vita idle timer only while those heartbeats are recent; normal auto-standby returns about 12 seconds after the bridge disappears. Heartbeats never inject neutral controls or interrupt held driving input.

Useful URLs:

- Live viewer: `http://127.0.0.1:8790/view`
- Latest frame: `http://127.0.0.1:8790/frame.bmp`
- Health/state: `http://127.0.0.1:8790/health`

After a Vita reboot, send a control packet to re-establish the peer and frame stream:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/tap -Method Post -ContentType application/json -Body '{"button":"ps","duration":120}'
```

Then check `frameAgeMs` from `/health`; a small value means frames are arriving.

## Control the Vita

Tap a button:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/tap -Method Post -ContentType application/json -Body '{"button":"circle","duration":120}'
```

Supported names are `up`, `right`, `down`, `left`, `cross`, `circle`, `square`, `triangle`, `l`, `r`, `start`, `select`, and `ps`.

Set buttons/sticks directly:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/state -Method Post -ContentType application/json -Body '{"press":["r"],"lx":180,"ly":128,"rx":128,"ry":128}'
Invoke-RestMethod http://127.0.0.1:8790/state -Method Post -ContentType application/json -Body '{}'
```

Stick values are `0..255`, centered at `128`. Always send a neutral state after a held state.

For sustained game driving, resend the held state every `30..45` ms because the Vita intentionally releases injected input when packets stop. Example: accelerate and steer right for roughly one second, then release:

```powershell
1..25 | ForEach-Object {
  Invoke-RestMethod http://127.0.0.1:8790/state -Method Post -ContentType application/json -Body '{"press":["r"],"lx":190}' | Out-Null
  Start-Sleep -Milliseconds 40
}
Invoke-RestMethod http://127.0.0.1:8790/state -Method Post -ContentType application/json -Body '{}'
```

Hardware UI quirks observed on this Vita:

- **Circle is confirm** and Cross is cancel in SceShell/VitaShell dialogs.
- D-pad Up/Down scrolls LiveArea pages.
- The analog stick is more reliable for selecting individual bubbles within a page.
- A `tap` duration around `120` ms is reliable. Very short taps can be missed; long repeated directional taps can move several pages.
- The remote plugin currently injects buttons and analog sticks, not touchscreen coordinates. Test touchscreen-only game features physically.

### Confirmed Figure 8 / VitaShell iteration loop

VitaShell always reopens in `ux0:/downloads`; do not navigate to another directory or try to reposition it first.

From Figure 8 to VitaShell:

1. Press PS.
2. Press D-pad Right.
3. Press Cross to open VitaShell; a second Cross may be required.
4. Press Select, then Cross to enter FTP mode.
5. To cancel FTP, press Select, then Circle.
6. From the top of Downloads, move Down 14 rows to `figure8_vita.vpk`.
7. Press Cross once to select it and Cross again to install.

From VitaShell back to Figure 8:

1. Press PS.
2. Press D-pad Left.
3. Press Cross to select/open Figure 8; a second Cross may be required.

## Build the game

From PowerShell:

```powershell
& 'C:\msys64\usr\bin\bash.exe' -lc '/c/Users/rafel/PromSRC/workspace/games/figure-8-drift-vita/build-vita.sh'
```

For an incremental rebuild:

```powershell
& 'C:\msys64\usr\bin\bash.exe' -lc 'export VITASDK=/usr/local/vitasdk; export PATH="$VITASDK/bin:/usr/bin:$PATH"; /usr/bin/cmake --build /c/Users/rafel/PromSRC/workspace/games/figure-8-drift-vita/build-v04 -j4'
```

Verify the result before delivery:

```powershell
Get-Item workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk
Get-FileHash workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk -Algorithm SHA256
```

## Preview the city locally

Use the native Windows preview before uploading major layout changes. It parses
the map arrays directly from `src/main.cpp`.

For Prometheus's complete edit/preview/build loop and the rules for adding roads
without breaking underpasses, read [`PROMETHEUS_WORKFLOW.md`](PROMETHEUS_WORKFLOW.md).

```powershell
python -m pip install -r requirements-preview.txt
python tools/check_city_layout.py
python tools/city_preview.py
```

Snapshot presets:

```powershell
python tools/city_preview.py --view overview --snapshot build-v04/city-preview.png
python tools/city_preview.py --view underpass --snapshot build-v04/city-underpass.png
python tools/city_preview.py --view roads --snapshot build-v04/city-roads.png
python tools/city_preview.py --view topdown --snapshot build-v04/city-topdown.png
```

## Preferred game update: direct backend install

This is the fastest normal workflow. It does not require putting the Vita in FTP mode or manually opening the VPK. It requires the current `prometheus_vita_control.suprx` to be installed and loaded.

With `control-server.mjs` running:

```powershell
curl.exe --max-time 180 --silent --show-error `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk" `
  http://127.0.0.1:8790/install-game
```

Success returns JSON with:

- `"ok": true`
- `"installed": "FIG8VITA1"`
- four successful `steps`, each with `status: 0`

The endpoint extracts/stages `eboot.bin`, `sce_sys/param.sfo`, and generated `sce_sys/package/head.bin`, then invokes the Vita package promoter. Do not claim installation succeeded unless the final promotion step is `status: 0`.

## Upload-only fallback

If direct promotion is unavailable but the companion upload server works, copy the VPK to `ux0:/downloads/figure8_vita.vpk`:

```powershell
curl.exe --max-time 180 --silent --show-error `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk" `
  http://127.0.0.1:8790/upload-game
```

This only uploads. The user must then install `ux0:downloads/figure8_vita.vpk` in VitaShell.

## FTP fallback and plugin updates

Current companions support backend plugin replacement, so FTP is now recovery-only. Update either fixed Prometheus plugin path without VitaShell:

```powershell
curl.exe --max-time 120 --silent --show-error -H "Content-Type: application/octet-stream" --data-binary "@workspace/games/prometheus-vita/deploy/prometheus_vita_control.suprx" http://127.0.0.1:8790/update-shell-plugin
curl.exe --max-time 120 --silent --show-error -H "Content-Type: application/octet-stream" --data-binary "@workspace/games/prometheus-vita/deploy/prometheus_vita_input.skprx" http://127.0.0.1:8790/update-kernel-plugin
```

These endpoints accept only the corresponding fixed plugin destination, checksum the complete payload, stage it beside the target, preserve the prior file as `.previous`, and atomically rename the new file. A successful response still requires a Vita reboot. They never modify `config.txt`.

Use FTP only if the loaded companion predates these endpoints or is broken.

1. Open VitaShell.
2. Ensure **Start > SELECT button > FTP**.
3. Press **Select**. VitaShell shows an address, normally `ftp://10.0.0.231:1337`.
4. Leave the FTP dialog open while transferring.

This Vita's Wi-Fi can answer slowly. Use at least a 25-second connection timeout:

```powershell
curl.exe --connect-timeout 25 --max-time 60 --disable-epsv ftp://10.0.0.231:1337/
```

Build and upload the SceShell companion:

```powershell
& 'C:\msys64\usr\bin\bash.exe' -lc '/c/Users/rafel/PromSRC/workspace/games/prometheus-vita/shell-plugin/build-vita.sh'
curl.exe --connect-timeout 25 --max-time 120 --disable-epsv `
  -T workspace/games/prometheus-vita/deploy/prometheus_vita_control.suprx `
  ftp://10.0.0.231:1337/ur0:/tai/prometheus_vita_control.suprx
```

Build and upload the kernel plugin:

```powershell
& 'C:\msys64\usr\bin\bash.exe' -lc '/c/Users/rafel/PromSRC/workspace/games/prometheus-vita/input-plugin/build-vita.sh'
curl.exe --connect-timeout 25 --max-time 120 --disable-epsv `
  -T workspace/games/prometheus-vita/deploy/prometheus_vita_input.skprx `
  ftp://10.0.0.231:1337/ur0:/tai/prometheus_vita_input.skprx
```

After uploading, download the remote file to a temporary path and compare its size and SHA-256 with the local build. Reboot after changing either loaded plugin. If hashes already match, do not rewrite the file unnecessarily.

## Troubleshooting

- `No ACK from Vita`: confirm the Vita is awake, on the same Wi-Fi, and still at `10.0.0.231`; retry once with a reliable 120 ms tap.
- Old/stale frame: send a button packet, then recheck `/health`. A rebooted Vita will not stream until the companion learns the PC peer again.
- FTP timeout but UDP control works: Vita Wi-Fi may be heavily delayed. We observed a 2.2-second ping and FTP taking about 6 seconds to accept. Raise `--connect-timeout`; do not immediately assume the server is broken.
- FTP listing is unavailable: confirm the VitaShell FTP dialog is visibly open. Merely opening VitaShell is not FTP mode.
- Direct install rejected: inspect every returned staging step. Confirm the installed companion matches `../prometheus-vita/deploy/prometheus_vita_control.suprx`, then reboot and retry.
- Plugin boot problem: power off, hold **L**, and boot to bypass plugins; restore the known-good files/config from `../prometheus-vita/backups/`.

## Current game controls

- Left stick: steer.
- R: accelerate.
- L: brake/reverse.
- Circle: handbrake/rear-grip release.
- While Circle is held, throttle can sustain the slide but cannot add speed; acceleration resumes after release.
- Mid-speed acceleration boost: 20–35 mph.
- Triangle: reset car.
- Select: cycle five camera modes, including hood and left-hand-drive cockpit views.
- Start: return to menu.
- Front touchscreen: tap the top-left HUD card to toggle between score/speed/combo and the minimap.

On foot:

- Square: exit the vehicle or re-enter when the prompt appears.
- Left stick: walk; hold D-pad Down to run.
- Right stick: free look horizontally and vertically.
- Cross (X): jump.
- Select: switch third-person/first-person on-foot camera.
- R: fire the selected unlimited-ammo weapon.
- Triangle: switch between rocket launcher and machine gun.

City destruction:

- Rockets remove a six-panel facade section, create launch and impact effects, and throw nearby street props.
- Machine-gun rounds remove one facade panel and lightly push street props.
- Lamps, benches, bus stops, stop signs, traffic lights, and street signs are knockable and respawn.

Do not change driving physics unless the user explicitly asks; the current drift handling is approved.
