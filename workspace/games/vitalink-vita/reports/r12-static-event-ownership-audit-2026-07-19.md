# VitaLink R12 — Bluetooth event ownership static audit

**Date:** 2026-07-19
**Scope:** Vita-as-Bluetooth-HID-peripheral/controller feasibility only. No on-device action was performed in R12.

## Decision

**Do not deploy a new kernel probe and do not call `ksceBtReadEvent`.** R11 established that broad Bluetooth callback registration can be created, delivered, unregistered, and deleted cleanly, but it did not establish the ownership or duplication semantics of the event queue that a callback signals. The last physical failure still occurs after bilateral SSP approval and before any registered-device slot or public error-state change. A raw event read while Sony Settings owns pairing could remove the security event that Settings must process.

This is the safest bounded R12 outcome: preserve the working R11 deployment and create the exact reverse-engineering gate that must pass before an event-drain experiment can be considered.

## Evidence inspected

| Source | Exact observation | Consequence |
|---|---|---|
| `reports/r11-retrieval/kernel-probe-r11.txt` | R11 completed callback lifecycle with eight delivered callbacks; all recorded `notify-id` values were `0xffffffff` and callback metadata did not expose an event payload. | Callback delivery proves neither event type nor queue ownership. |
| `plugin/main.c` (R11) | The probe uses `ksceBtRegisterCallback` and callback metadata only; it explicitly forbids `ksceBtReadEvent`, pairing replies, connection, deletion, SDP/HID/L2CAP and configuration writes. | R11 did not consume an event needed by stock Settings. |
| `vendor/ds4vita/main.c` lines 505–579 | `xerpi/ds4vita` treats `ksceBtReadEvent(&hid_event, 1)` as a destructive consumer: it loops on overflow, reads a 16-byte `SceBtEvent`, dispatches IDs, then calls controller-specific operations. Its `0x04` path replies to a link-key/user-confirmation event. | This is strong evidence that a reader changes queue state, not evidence of a separate per-callback queue. Its behavior is unsafe to copy during Settings pairing. |
| R8/R9/R10 physical evidence in `VITA_SYSTEM_RUNBOOK.md` | Matching SSP code appeared on iPhone and Vita; bilateral Pair ended in Vita `An error has occurred`; no persistent bond. R10's 50 ms samples held `lastError=0`, `configuration=0x00000009`; registered slots stayed empty. | The unresolved boundary remains link-key/bond completion or profile/service policy. Public passive APIs cannot distinguish them. |
| VitaLink R11 source/import boundary | Existing probe links `SceBtForDriver_stub`; existing public usage does not establish a documented per-client event-consumer contract. | No safe ABI basis exists for guessing a raw-event buffer, callback mapping, or reply argument. |

## Read-only firmware retrieval (actual R12 result)

R12 used the established VitaShell FTP endpoint at `10.0.0.231:1337` for **LIST/CWD/LIST/RETR only**. It issued no `STOR`, `DELE`, rename, config, plugin, bond, or radio operation.

- Root `LIST` exposed `vs0:`. Plain path-qualified `LIST` mostly returned `550 Invalid directory`; `CWD vs0:` followed by `LIST` worked and exposed `app`, `data`, `sys`, `tool`, `vsh`, and `SceIoTrash`.
- Sequential `CWD vs0:` → `app` and `CWD vs0:` → `sys` → `external` works, exposing 56 system-app IDs, 141 external modules, and the `os0:/kd` module list. The guessed external `libSceBt*` paths are absent from that actual listing. The direct Settings candidate `vs0:/app/NPXS10015/eboot.bin` returned `550`; its application directory is visible but its child directory cannot be listed through this FTP server.
- The exact Bluetooth/WLAN kernel image **is present** in the actual `os0:/kd` listing and was retrieved read-only: `os0:/kd/wlanbt_robin_img_ax.skprx`, **310,941 bytes**, SHA-256 **`927786e1737a6c515b706c34155884ed74e17fd563a2a52523834ecf363f5a3a`**. The signed `SCE\0` wrapper contains a 310,781-byte embedded ARM ELF at offset 160 (SHA-256 `053f5434e3a655ce4ebefc1fcbf8c71a80f0f7719f420030b7d8f092d1fb9e01`). `readelf` proves an ARM ELF32 Type `0xfe04` with three program headers, but no section headers or dynamic section; plaintext symbol searches contain no `SceBt`, `ksceBt`, `Bluetooth`, `HID`, `L2CAP`, `RegisterCallback`, or `ReadEvent`. This is the exact radio firmware image but not yet a call-path proof; it must be disassembled by load segment/offline firmware analysis rather than inferred from strings.
- Retrieval succeeded for `vs0:/app/NPXS10026/eboot.bin`: **517,373 bytes**, SHA-256 **`f4e1b7eecdae0289365c9415967f8dea076e463f38cf781d987ab2cf2439b951`**, preserved as `reports/r12-firmware-retrieval/vs0__app__NPXS10026__eboot.bin`. It is a signed `SCE\0` container (embedded ELF starts at offset 160), so standard `arm-vita-eabi-readelf` cannot analyze it directly. Byte search finds no plaintext `SceBt`, `ksceBt`, `Bluetooth`, `HID`, `L2CAP`, or pairing strings.
- `vs0:/app/NPXS10026/sce_sys/param.sfo` also retrieved: **5,132 bytes**, SHA-256 **`7b7b006a53c7c4139dca8fa0a45e07a9c25357f57f972fe2d8da807e71243707`**. Its parsed metadata identifies title ID `NPXS10026` as **Content Manager**, not Bluetooth Settings. Therefore it is firmware-matched and authentic to the target Vita but not the desired Bluetooth caller.

Evidence is retained in `reports/r12-firmware-retrieval/retrieval-manifest.json`, `retrieval-manifest-cwd.json`, `offline-analysis.txt`, and `param-sfo-analysis.txt`. The concrete FTP blocker is now narrowed: VitaShell permits root and `vs0:` CWD listing but rejects path-qualified subdirectory listing/CWD, while exact-file `RETR` works. The safe alternate extraction mechanism is a **read-only firmware dump/export from an already-authorized local Vita maintenance tool** (or a verified firmware package matching this Vita) followed by offline container decryption/extraction; do not install or enable any new kernel plugin merely to obtain it.

## R12 proof boundary

R12 proves a **negative safety result**, not a HID capability:

1. We have proof that callback notification delivery is possible without reading an event.
2. We do **not** have proof that `ksceBtReadEvent` is non-consuming, callback-scoped, thread-scoped, or independent from stock Sony Settings.
3. Public controller-side code contains a direct event drain followed by security/connection actions; it cannot be repurposed as a passive pairing observer.
4. Therefore deploying an event reader now would introduce an unbounded regression risk without producing trustworthy controller-peripheral evidence.

## Exact smallest next test — static only

Obtain the **exact firmware-matched** `SceBt` implementation and the stock Settings Bluetooth caller/import stubs from the Vita. Then reverse only the following two call paths:

1. `ksceBtRegisterCallback` / callback delivery: identify the registration record and whether its callback UID, thread, or a process/session object owns an event queue.
2. `ksceBtReadEvent`: identify its queue/ring-buffer source and dequeue operation; classify it as one of:
   - `global destructive queue` — event reads remain permanently forbidden during Settings pairing;
   - `per-registration/per-process queue` — an isolated reader may be considered only after a separate non-pairing duplicate-delivery test;
   - `broadcast/ref-counted event stream` — a tightly bounded reader may be designed, still without replies.

Record instruction addresses, import NIDs, queue-owner field offsets, and the exact dequeue primitive. Do not infer any result from `SceBtEvent`'s public 16-byte consumer layout alone.

### Acceptance condition before any R13 runtime probe

A runtime probe is justified only if the static trace directly shows that a VitaLink registration receives a queue distinct from stock Settings **or** the implementation explicitly ref-counts/broadcasts events to all subscribers. Until then:

- no `ksceBtReadEvent` during Sony Settings pairing;
- no pairing/PIN replies, connect, bond deletion, SDP/HID/L2CAP calls, configuration writes, or advertising changes;
- leave the deployed R11 plugin and its config entry untouched.

## Deployment status

**Not attempted by design.** Raul's open VitaShell FTP session is preserved; no files, config, bonds, or radio/profile state were changed in R12. Existing R11 hashes remain the last hardware-verified deployment evidence.
