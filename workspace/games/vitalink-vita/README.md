# VitaLink Vita — Milestone 1 / Gate 1

For the complete, hardware-tested Prometheus control stack—including taiHEN
placement, recovery, system-wide Wi-Fi viewing/input, backend game/plugin
updates, FTP readback verification, reboot rules, and the `download` versus
`downloads` path trap—read
[`VITA_SYSTEM_RUNBOOK.md`](VITA_SYSTEM_RUNBOOK.md).

A separate, **diagnostic-only** Vita project for the first question behind VitaLink: can a Vita expose the Bluetooth Classic capabilities needed for an iPhone-compatible HID peripheral? This milestone does not claim that it can.

## What the VPK proves

`vitalink_probe.vpk` is a native VitaSDK app with a readable on-device screen and a deterministic report at `ux0:data/vitalink-probe-report.txt`. It records each required capability as either public API available, no public import linked, or unsupported. It never alters radio state, never starts discovery, registers SDP, opens L2CAP, or impersonates a HID device.

The adapter (`src/bt_adapter.c`) is the sole future private-NID boundary. Public VitaSDK headers/link libraries available to this build contain no verified Classic Bluetooth peripheral, discoverability/page-scan, local identity/Class-of-Device, SDP server, or L2CAP server API. The kernel probe is intentionally log-only: it establishes a safely rollbackable plugin route without calling undocumented symbols.

## Build and package (Windows / native MSYS2)

```powershell
& 'C:\msys64\usr\bin\bash.exe' games/vitalink-vita/build-vita.sh
Get-FileHash games/vitalink-vita/deploy/vitalink_probe.vpk -Algorithm SHA256
cd games/vitalink-vita; node --test
```

The build script exports `VITASDK=/usr/local/vitasdk`; do not use WSL. If Windows Application Control blocks VitaSDK `collect2.exe`, use the verified `collect2` shim recovery described in `../figure-8-drift-vita/PROMETHEUS_WORKFLOW.md`, retaining the original backup.

## Deployment design / normal Raul workflow

This project reuses the already resident `prometheus_vita_control.suprx` TCP uploader on port 18790 without changing Prometheus Vita behavior. Its protocol has typed uploads, FNV-1a integrity, temporary writes, atomic rename, and backup/rollback for kinds 7/8. VitaLink uses only existing safe kinds:

- `1` VPK → `ux0:downloads/figure8_vita.vpk` is **not used** by automation because that legacy destination is Figure-8 named. Install the VitaLink VPK manually from a staged copy only, pending a generalized resident uploader update.
- `7` shell plugin → `ur0:tai/prometheus_vita_control.suprx` is **reserved by Prometheus** and is **not used** by VitaLink automation.
- `8` kernel input plugin → `ur0:tai/prometheus_vita_input.skprx` is also **reserved by Prometheus** and must never be used for the VitaLink probe.

`pc-bridge/vitalink-upload.mjs` is a tested compatibility client/parser rather than a blind uploader: it accepts only resident kinds, verifies acknowledgement byte count and FNV-1a checksum, and records SHA-256 locally. Its `plugin` kind exists only as a protocol-contract test; it must not be used against Raul's existing companion because kind 7 would replace its shell plugin. This conservative isolation preserves current Prometheus/Figure 8 behavior.

### One-time prerequisite for any future kernel probe

1. Make sure taiHEN/Enso and VitaShell are already functioning.
2. Back up the active `ur0:tai/config.txt` and confirm which config is active.
3. Copy `deploy/vitalink_bt_probe_kernel.skprx` to `ur0:tai/` (do not replace a Prometheus filename).
4. Add it once under the existing `*KERNEL` section, then reboot.
5. **Hold L at boot** to bypass plugins if startup fails; restore the previous config/plugin from VitaShell.

No remote install or deploy was attempted in this milestone. The historical companion (`10.0.0.231`) was not reachable during the local validation, so there is no physical hardware claim.

## Gate 1 hardware checklist

1. Install `deploy/vitalink_probe.vpk` in VitaShell and launch it.
2. Press X; export and retrieve `ux0:data/vitalink-probe-report.txt`.
3. If a future documented adapter is added, record exact module/library/NID provenance before enabling it.
4. Confirm adapter-reported device address/name, Class of Device, discoverable and connectable state with a separate phone/PC observer.
5. Register a test SDP record, verify it remotely, and remove it after reboot testing.
6. Open a test L2CAP listener and verify a remote client can connect/reject safely.
7. Only then attempt HID descriptor/control channels. Verify iPhone discoverability and input only with physical evidence.

## R13 static feasibility gate (2026-07-19)

R13 performed a **static-only** review of the exact retrieved WLAN/Bluetooth image and the R11/R12 evidence. It did **not** build, deploy, or run a new probe. The recovered `wlanbt_robin_img_ax.skprx` image is firmware-matched, but its embedded ELF has no section headers, dynamic section, or recoverable dynamic symbols, and the matching Sony Settings (`NPXS10015`) caller/import table was not retrievable. Consequently, `ksceBtReadEvent` remains **potentially global/destructive** and forbidden during Sony Settings pairing; R11 stays unchanged.

See [`reports/r13-feasibility-2026-07-19/R13_STATIC_FEASIBILITY.md`](reports/r13-feasibility-2026-07-19/R13_STATIC_FEASIBILITY.md) for hashes, offsets, verified call sites, and the exact next offline target. No controller/HID peripheral capability is claimed: it still requires independently verified local advertisement/profile support.

## Artifacts

- `deploy/vitalink_probe.vpk` — build output; installing it needs no reboot.
- `deploy/vitalink_bt_probe_kernel.skprx` — safe log-only kernel scaffold; needs config entry + reboot if tested.
- `deploy/SHA256SUMS.txt` — generated after packaging.
