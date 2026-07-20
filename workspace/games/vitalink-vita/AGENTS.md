# VitaLink agent instructions

Before modifying, building, or deploying anything in this project, read
[`VITA_SYSTEM_RUNBOOK.md`](VITA_SYSTEM_RUNBOOK.md) completely. It is the
workspace source of truth for the existing Prometheus Vita kernel input plugin,
SceShell companion, Wi-Fi viewer/control bridge, backend updater, FTP fallback,
reboot boundaries, and L-at-boot recovery.

VitaLink is currently a diagnostic Bluetooth capability probe. Do not present it
as a working iPhone HID implementation. Do not upload
`vitalink_bt_probe_kernel.skprx` through Prometheus's
`/update-kernel-plugin` endpoint: that route has a fixed destination and would
replace `prometheus_vita_input.skprx`. Keep the VitaLink probe under its own
filename and config entry.

Never overwrite the Vita's entire taiHEN config. Back it up, edit the existing
section once, verify the exact active tai directory, and retain the hold-L boot
recovery path. Build/package success is not hardware proof; record installation,
reboot, ACK/frame, report, or physical behavior separately.
