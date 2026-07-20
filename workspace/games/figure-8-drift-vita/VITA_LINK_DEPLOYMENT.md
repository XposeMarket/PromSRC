# Figure 8 Vita link and deployment handoff

Prometheus should use this file when it needs to view/control the Vita, upload a
build, or decide whether a reboot is necessary. The complete cross-project
kernel/plugin runbook is
[`../vitalink-vita/VITA_SYSTEM_RUNBOOK.md`](../vitalink-vita/VITA_SYSTEM_RUNBOOK.md).

## Fastest normal loop

1. Validate and build:

   ```powershell
   cd C:\Users\rafel\PromSRC\workspace\games\figure-8-drift-vita
   python tools/check_city_layout.py
   & 'C:\msys64\usr\bin\bash.exe' -lc 'export VITASDK=/usr/local/vitasdk; export PATH="$VITASDK/bin:/usr/bin:$PATH"; /usr/bin/cmake --build /c/Users/rafel/PromSRC/workspace/games/figure-8-drift-vita/build-v04 -j4'
   Get-FileHash build-v04\figure8_vita.vpk -Algorithm SHA256
   ```

2. Start the system bridge from the repository root:

   ```powershell
   $env:VITA_IP='10.0.0.231'
   node workspace/games/prometheus-vita/pc-bridge/control-server.mjs
   ```

3. Check `http://127.0.0.1:8790/health`, send one `ps` tap, then verify a recent
   `frameAgeMs`. View the Vita at `http://127.0.0.1:8790/view`.

4. Install the game directly:

   ```powershell
   curl.exe --max-time 180 --silent --show-error `
     -H "Content-Type: application/octet-stream" `
     --data-binary "@workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk" `
     http://127.0.0.1:8790/install-game
   ```

5. Require `ok: true`, `installed: FIG8VITA1`, and `status: 0` for every step.
   Close and reopen Figure 8. A normal game update does **not** need a Vita reboot.

## If direct installation is unavailable

Try `POST /upload-game` while the system companion is loaded. It stages the VPK
at `ux0:downloads/figure8_vita.vpk`, but the user must install it in VitaShell.

If the companion is unavailable, use VitaShell FTP on port `1337`. Upload to
`ux0:/downloads/` (plural), preferably with a unique filename, and download the
same exact path back to compare size and SHA-256. Do not rely on directory
listing: this Vita FTP server can reject `LIST` with `502` while direct
`STOR`/`RETR` work correctly.

Do not use `ux0:/download/` singular for the normal install loop. We verified
that it can accept a file, but it is a different directory from the plural
Downloads folder VitaShell normally opens; this caused an upload to appear
missing even though its remote hash matched.

## Plugin changes are different from game changes

The game VPK is user-mode content. Install/relaunch is enough. The two system
plugins live outside the game:

- `ur0:tai/prometheus_vita_input.skprx` under `*KERNEL`
- `ur0:tai/prometheus_vita_control.suprx` under `*main`

They can be replaced through `/update-kernel-plugin` and
`/update-shell-plugin`, respectively, without entering FTP mode, but the Vita
must reboot before the replacement code is active. Those routes preserve a
`.previous` backup and never modify `config.txt`.

If a plugin breaks boot, hold L during startup to bypass plugins, then restore
the known-good file/config. Never overwrite all of `ur0:tai/config.txt` just to
add one entry.

## Control/testing truths

- `127.0.0.1:8790` is the Windows HTTP bridge, not the Vita itself.
- `10.0.0.231:18791` is system input/ACK; `18790` is frame/upload traffic.
- The game-specific `pc-bridge` on UDP `18792/18793` is separate and does not
  replace system-wide SceShell control.
- A healthy local `/health` response does not prove the Vita is awake or linked.
  Use ACK plus a recent frame.
- Send held driving state every `30..45 ms`, then send `{}` to release it.
- Remote touch coordinates are not implemented; touchscreen behavior still
  needs physical testing.
- The local city preview checks geometry/layout, not exact Vita rendering,
  frame pacing, controller feel, or plugin behavior.
