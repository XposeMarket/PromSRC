# VitaLink R13 — Static Bluetooth Event-Ownership Feasibility

**Date:** 2026-07-19
**Scope:** Offline analysis only. No Vita FTP session, deployment, reboot, Bluetooth mutation, event read, pairing reply, connection, HID/L2CAP/SDP call, or advertisement was performed for R13.

## Decisive outcome

**Outcome B — no R13 runtime probe is built or deployed.** The exact-firmware WLAN/Bluetooth image proves that the physical radio-side module is present, but it does not expose recoverable import/export/symbol metadata or queue ownership. The matching Sony Settings caller was not retrieved. Therefore there is no static proof that `ksceBtReadEvent` is subscriber-scoped, duplicated, or non-destructive for a second registration.

**Safety classification: unresolved; treat `ksceBtReadEvent` as potentially global and destructive.** It remains forbidden while Sony Settings owns pairing. A callback-only observer has been proven safe enough to create/unregister, but the R11 callback ABI supplies no event payload and cannot establish queue isolation.

## Evidence ledger

| Evidence | Exact verified observation | Consequence |
|---|---|---|
| R11 observer log, lines 1–16 | `ksceBtRegisterCallback=0`; callback unregister succeeds; eight callbacks arrive with `notify-id=0xffffffff`, `notify-count=1`, zero common/argument, and no event payload. | Callback notification delivery exists, but it does not identify event type, queue owner, or duplication semantics. |
| R11 source `plugin/main.c:52–67, 103–115, 130–144` | The registration uses `ksceBtRegisterCallback(callback_uid, 0, 0xffffffff, 0xffffffff)`; callback body records metadata plus `ksceBtGetLastError`/`ksceBtGetConfiguration`; it never invokes `ksceBtReadEvent`; cleanup unregisters/deletes the callback. | Existing installed probe is an observer, not an event consumer. It must remain unchanged. |
| R12 event-ownership audit, lines 16–20, 34–41, 43–61 | Public `ds4vita` consumes 16-byte `SceBtEvent` records through `ksceBtReadEvent` and then takes event-specific security/controller actions. The audit found no per-client queue proof. | Public consumer code is evidence of a dequeue-style API, not evidence of a safe passive parallel reader. |
| Firmware artifact `os0__kd__wlanbt_robin_img_ax.skprx` | `310,941` bytes; SHA-256 `927786e1737a6c515b706c34155884ed74e17fd563a2a52523834ecf363f5a3a`. Its SCE wrapper contains the extracted ELF below at file offset `0xA0` (160). | This is firmware-matched radio-side evidence, not a caller ABI proof. |
| Embedded ELF `os0__kd__wlanbt_robin_img_ax.embedded.elf` | `310,781` bytes; SHA-256 `053f5434e3a655ce4ebefc1fcbf8c71a80f0f7719f420030b7d8f092d1fb9e01`; ELF32 little-endian ARM EABI5, type `0xfe04`, program header offset `0x34`, 3 program headers, no section headers, no dynamic section, and no dynamic symbols. | Static ELF metadata has no names/NIDs that can associate `ksceBtReadEvent`, callback registrations, or queue fields with code offsets. |
| R12 string scan / `offline-analysis.txt` | No plaintext `SceBt`, `ksceBt`, `Bluetooth`, `HID`, `L2CAP`, `RegisterCallback`, or `ReadEvent` strings. | The image cannot support a defensible named call-path trace without further format-aware extraction/reconstruction. |
| `retrieval-manifest.json:56–72` | `vs0:/app/NPXS10026/eboot.bin` was retrieved, but its PARAM.SFO identifies Content Manager, not Settings. `vs0:/app/NPXS10015/eboot.bin` retrieval returned `550 File not found`. | The matching Settings Bluetooth caller/import table is missing. No NID can be attributed to Settings. |

## Module and API map (bounded to verified evidence)

1. **Radio-side firmware candidate:** `os0:/kd/wlanbt_robin_img_ax.skprx`. It is the only firmware-matched WLAN/Bluetooth system image actually retrieved in R12. No assertion is made that it exports the `SceBtForDriver` API surface, because its extracted ELF has no recoverable export table/symbol names from standard tooling.
2. **VitaLink caller-side library:** existing `plugin/main.c` includes `<psp2kern/bt.h>` and resolves its calls through the build’s `SceBtForDriver_stub` linkage documented in the R12 audit. The project call sites are: `ksceBtRegisterCallback`, `ksceBtUnregisterCallback`, `ksceBtSetInquiryScan`, `ksceBtGetLastError`, and `ksceBtGetConfiguration`. **No numeric NID is present in the project evidence.**
3. **Stock owner/caller:** Sony Settings, expected title ID `NPXS10015`, remains unextracted. R12’s exact FTP retrieval attempt was denied. No Settings import library, import NID, caller offset, or callback registration record can be named honestly.
4. **`ksceBtReadEvent`:** no project runtime call exists. Its library/NID is not recoverable from the retrieved artifact or project source. The consumer behavior in public third-party code is insufficient to classify it as global or subscriber-scoped.

## Why a probe is unsafe

The necessary safety predicate is one of the following direct static findings:

- a per-registration or per-process queue object is selected from the callback registration record and the VitaLink reader targets a distinct instance; or
- events are duplicated/ref-counted/broadcast to each registered subscriber before any reader dequeues them.

Neither predicate is established. In contrast, a read-like API with callback wakeups is consistent with a shared queue where a read removes the next pairing/security event before Settings consumes it. Given the observed physical failure occurs after SSP confirmation, stealing one security transition would confound diagnosis and could worsen the stock path. The smallest safe build is therefore **no new build**: preserve deployed R11 exactly and keep R13 static-only.

## Exact next reverse-engineering target

Acquire, through an already-authorized **read-only** firmware dump/export or a verified matching firmware package:

1. the `SceBtForDriver` implementation/stub that defines the imports used by `psp2kern/bt.h`;
2. `vs0:/app/NPXS10015/eboot.bin` and its module/import table; and
3. any Settings Bluetooth submodule imported by that executable.

Then, offline and on the exact matching firmware:

1. resolve `ksceBtRegisterCallback` and `ksceBtReadEvent` import NIDs and call-site offsets in Settings;
2. trace registration allocation/lookup to the callback UID, process/session, and event queue pointer;
3. trace `ksceBtReadEvent` to the queue/ring-buffer dequeue primitive; and
4. classify the path as **global destructive**, **per-registration/process**, or **broadcast/ref-counted**.

Only the latter two, with concrete instruction offsets and queue-owner field offsets, can justify a new reply-free reader test. If global/destructive, do not read events during Settings pairing; use a non-consuming import/callback trace instead. Separately, any controller/HID claim still requires an independently verified local HID peripheral advertisement/profile capability; no R13 evidence demonstrates it.

## Reproducible local checks

```powershell
# Hash and inspect the exact preserved artifacts
Get-FileHash reports/r12-firmware-retrieval/os0__kd__wlanbt_robin_img_ax.skprx -Algorithm SHA256
Get-FileHash reports/r12-firmware-retrieval/os0__kd__wlanbt_robin_img_ax.embedded.elf -Algorithm SHA256
& 'C:\msys64\usr\bin\bash.exe' -lc 'readelf -h reports/r12-firmware-retrieval/os0__kd__wlanbt_robin_img_ax.embedded.elf; readelf -S reports/r12-firmware-retrieval/os0__kd__wlanbt_robin_img_ax.embedded.elf; readelf -sW reports/r12-firmware-retrieval/os0__kd__wlanbt_robin_img_ax.embedded.elf'

# Confirm R11 remains non-consuming.
Select-String -Path plugin/main.c -Pattern 'ksceBtReadEvent|ksceBtRegisterCallback|ksceBtUnregisterCallback'
```

## Non-actions preserved

- No FTP action in R13 (the open VitaShell session was deliberately left untouched).
- No upload, install, config edit, reboot, or replacement of R11.
- No event read, pairing/PIN reply, connection, bond deletion, inquiry state change, SDP/HID/L2CAP action, or advertisement/profile mutation.
