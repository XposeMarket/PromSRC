# PS Vita system link, kernel plugins, and Wi-Fi deployment

This is the authoritative operations runbook for the Vita used by Prometheus.
It documents the working system-control stack shared by VitaLink, Prometheus
Vita, and Figure 8 Drift. Read this before changing plugins or deploying a VPK.

## What is installed

| Layer | Vita file / PC service | Purpose | Reload requirement |
| --- | --- | --- | --- |
| Kernel input | `ur0:tai/prometheus_vita_input.skprx` under `*KERNEL` | Receives checksummed UDP input on `18791`, injects buttons/sticks, and returns ACK telemetry | Reboot |
| Shell companion | `ur0:tai/prometheus_vita_control.suprx` under `*main` | System-wide capture, keep-awake heartbeat, TCP uploads, atomic plugin replacement, and Figure 8 promotion on `18790` | Reboot in the normal workflow |
| Windows bridge | `../prometheus-vita/pc-bridge/control-server.mjs` on `127.0.0.1:8790` | HTTP API, browser viewer, input sender, frame receiver, uploader, and installer | Restart the Node process only |
| Optional USB video | `ur0:tai/udcd_uvc.skprx` under `*KERNEL` | Exposes the Vita as a UVC camera over USB | Reboot |

Known Vita address: `10.0.0.231`. It is a DHCP address, so verify it after a
router or network change. The active taiHEN configuration on this unit is
`ur0:tai/config.txt`; do not assume `ux0:tai` is active.

The system-wide Wi-Fi stream does not need USB. UVC is an optional, usually
higher-quality USB viewing route. VitaShell FTP also uses Wi-Fi and does not
need USB.

## Safety and recovery

- Back up `ur0:tai/config.txt` and every plugin before its first replacement.
- Add entries to the existing `*KERNEL` or `*main` section. Never create a
  second section header or replace the whole config with the sample file.
- Keep `prometheus_vita_input.skprx` after `udcd_uvc.skprx` under `*KERNEL`.
- Keep `prometheus_vita_control.suprx` under `*main`, not `*KERNEL`.
- Hold **L while booting** to bypass taiHEN plugins if a plugin causes a boot
  problem. Restore the known-good file/config using VitaShell.
- The backend plugin-update endpoints only replace their fixed Prometheus
  destinations. They do not edit `config.txt` and cannot safely install an
  arbitrary VitaLink kernel plugin.

## One-time bootstrap

The backend cannot update itself until the shell companion is already installed
and loaded. Initial installation therefore requires VitaShell over FTP or USB.

1. Copy `prometheus_vita_input.skprx` to `ur0:tai/` and add this under the
   existing `*KERNEL` section:

   ```text
   ur0:tai/prometheus_vita_input.skprx
   ```

2. Copy `prometheus_vita_control.suprx` to `ur0:tai/` and add this under the
   existing `*main` section:

   ```text
   ur0:tai/prometheus_vita_control.suprx
   ```

3. Reboot the Vita. A VPK reinstall alone does not load either plugin.
4. If input is not listening, inspect
   `ur0:data/prometheus_vita_input.log` for `thread-ready`, `socket-open`,
   `listening-18791`, packet, bind, or checksum records.

The current example layout is in
`../prometheus-vita/deploy/config.with-system-control.txt`. Treat it as a
reference, not a file to overwrite onto the Vita.

## Start and verify the Windows bridge

Run from `C:\Users\rafel\PromSRC`:

```powershell
$env:VITA_IP='10.0.0.231'
node workspace/games/prometheus-vita/pc-bridge/control-server.mjs
```

In another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/health
Invoke-RestMethod http://127.0.0.1:8790/tap -Method Post `
  -ContentType application/json -Body '{"button":"ps","duration":120}'
```

Open `http://127.0.0.1:8790/view` for the Wi-Fi viewer. `/health` proving the
local Node service is alive is not by itself proof that the Vita is linked.
Check for a recent `frameAgeMs` and a successful input ACK. After a reboot, send
one input packet so the companion learns the current PC peer and starts sending
frames.

The bridge sends a keep-awake heartbeat every three seconds. It resets idle time
only while the bridge is recent; it does not hold neutral input or change game
controls. If `127.0.0.1:8790` is offline, start the Node bridge. If the bridge is
online but the Vita has no ACK/frame, verify that the Vita is awake, on the same
Wi-Fi, still at the configured IP, and has been rebooted since the last plugin
replacement.

## Remote control API

Tap a button:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/tap -Method Post `
  -ContentType application/json -Body '{"button":"circle","duration":120}'
```

Hold buttons or sticks, then explicitly release:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/state -Method Post `
  -ContentType application/json -Body '{"press":["r"],"lx":190,"ly":128,"rx":128,"ry":128}'
Invoke-RestMethod http://127.0.0.1:8790/state -Method Post `
  -ContentType application/json -Body '{}'
```

Stick values are `0..255`, centered at `128`. Sustained driving input must be
resent every `30..45 ms`; injection intentionally expires when packets stop.
Supported button names are `up`, `right`, `down`, `left`, `cross`, `circle`,
`square`, `triangle`, `l`, `r`, `start`, `select`, and `ps`. Touch input is not
implemented. In the confirmed loop, Cross opens bubbles and selects/installs the
highlighted VitaShell entry; Select then Cross enters FTP, and Select then Circle
cancels FTP. Follow the visible modal labels if a region/button preference changes.

## Backend updates without FTP

Once the companion is loaded, routine Figure 8 and Prometheus plugin transfers
do not require VitaShell FTP.

Replace the shell companion:

```powershell
curl.exe --max-time 120 --silent --show-error `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@workspace/games/prometheus-vita/deploy/prometheus_vita_control.suprx" `
  http://127.0.0.1:8790/update-shell-plugin
```

Replace the kernel input plugin:

```powershell
curl.exe --max-time 120 --silent --show-error `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@workspace/games/prometheus-vita/deploy/prometheus_vita_input.skprx" `
  http://127.0.0.1:8790/update-kernel-plugin
```

Both routes checksum the full payload, write a temporary neighbor, preserve the
old file as `.previous`, and atomically rename the new file. A successful JSON
response means the bytes were replaced; **reboot is still required** to execute
the new plugin.

Figure 8 can be directly installed without FTP and without rebooting:

```powershell
curl.exe --max-time 180 --silent --show-error `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk" `
  http://127.0.0.1:8790/install-game
```

Only claim success when JSON contains `"ok":true`, title `FIG8VITA1`, and every
promotion step has `status: 0`. This endpoint is intentionally Figure-8-specific;
it is not a general arbitrary-VPK or VitaLink installer.

`POST /upload-game` is upload-only. It writes
`ux0:downloads/figure8_vita.vpk`; the user must install that file in VitaShell.

## VitaShell FTP fallback over Wi-Fi

1. Open VitaShell.
2. In Start settings, set the Select button action to FTP.
3. Press Select and leave the FTP dialog open. The normal address is
   `ftp://10.0.0.231:1337`.
4. Confirm the FTP control connection is actually ready before uploading. A TCP-open
   port alone is insufficient: run a bounded root listing and require the
   `220 FTPVita Server ready` greeting (or a successful directory response):

   ```powershell
   curl.exe --ftp-pasv --connect-timeout 8 --max-time 20 --show-error --fail `
     ftp://10.0.0.231:1337/
   ```

   Immediately after FTP is opened, the port can transiently accept TCP without
   sending its greeting. If that bounded readiness check times out, leave the
   dialog open for a few seconds and retry once before closing/reopening FTP.
5. Upload while that screen remains open.

Use the **plural** install directory on this setup:

```powershell
curl.exe --ftp-pasv --connect-timeout 25 --max-time 120 --show-error --fail `
  --upload-file workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk `
  ftp://10.0.0.231:1337/ux0:/downloads/FIGURE8_NEW.vpk
```

Important: `ux0:/download/` (singular) has accepted and returned files over FTP,
but VitaShell normally opens `ux0:/downloads/` (plural). Uploading to the singular
directory can succeed byte-for-byte while appearing to “not land” in the folder
the user is viewing. Use `downloads` unless the VitaShell path bar explicitly
shows otherwise. Use a new filename for a test build so it cannot be mistaken
for an older entry.

This FTP server may return `502` for `LIST`/`NLST`. That does not prove an upload
failed. Conversely, a successful TCP connect without the FTP `220` greeting does
not prove the server is ready. Verify a deployment by downloading the exact known
path and comparing it:

```powershell
$local='workspace/games/figure-8-drift-vita/build-v04/figure8_vita.vpk'
$remote="$env:TEMP\figure8-vita-readback.vpk"
curl.exe --ftp-pasv --connect-timeout 25 --max-time 120 --show-error --fail `
  --output $remote ftp://10.0.0.231:1337/ux0:/downloads/FIGURE8_NEW.vpk
Get-Item $local,$remote | Select-Object FullName,Length
Get-FileHash $local,$remote -Algorithm SHA256
```

Confirmed VitaLink Gate 1 transfer (2026-07-18): `vitalink_probe.vpk` was uploaded
as `ux0:/downloads/VITALINK_GATE1.vpk`, read back as 40,537 bytes, and matched
SHA-256 `ccbe3fb26ca0fc279a1fb9dd7b9050e7c3da9f69112cf84a961aa4eb977e8431`.
A mistakenly uploaded duplicate at `ux0:/VITALINK_GATE1.vpk` was removed after
the verified `downloads` copy was established.

### VitaShell `0x8010113D` during VPK installation

On this Vita, `0x8010113D` has been reproduced with otherwise byte-perfect VPKs
when packaged PNG artwork is not Vita-compatible. A 128×128 RGB PNG can still
trigger the error, and a structurally broken PNG may pass through the VPK build
without being decoded. Treat this as an asset/package-validation failure before
suspecting FTP when download-back bytes already match.

For every Vita VPK:

1. Decode and verify each packaged PNG before building.
2. Re-encode package artwork as a non-interlaced 8-bit indexed/palette (`P`) PNG.
3. Clean-build with VitaSDK; do not manually patch or re-zip the VPK.
4. Test ZIP integrity and reopen the PNG extracted from the completed VPK.
5. Upload, download the exact remote path, then compare size, SHA-256, and bytes.

VitaLink Gate 1 correction (2026-07-18): the original
`assets/sce_sys/icon0.png` reported RGB 128×128 but failed full Pillow decoding
with a broken PNG chunk. It was replaced with a valid 128×128 palette PNG, the
VPK was clean-rebuilt and ZIP/image-validated, then uploaded over the same
verified FTP route. Corrected package: 41,060 bytes, SHA-256
`0d7b289bc361e2b6140d5b46d11174ad0e9e8f73e7622e1c17033fc11a99bac9`.
The read-back copy matched exactly.

### VitaLink Gate 1 black screen after successful launch

The first corrected-icon build launched but displayed only black. Root cause: the
probe submitted a static CPU/BSS array with pitch 960 directly to
`sceDisplaySetFrameBuf`. A Vita user framebuffer must use an appropriately aligned
memory block; the VitaSDK reference path uses CDRAM and a 1024-pixel pitch. The
original app also ignored the display API return code, hiding the failure.

The corrected probe allocates an aligned `SCE_KERNEL_MEMBLOCK_TYPE_USER_CDRAM_RW`
framebuffer, uses pitch 1024, waits for vertical blank, and writes allocation/base/
display return codes into `ux0:data/vitalink-probe-report.txt`. This is a VPK-only
UI correction: it does not load the Bluetooth kernel scaffold, alter radio state,
edit taiHEN config, or require a reboot.


Corrected Gate 1 R2 package (2026-07-18): uploaded as
`ux0:/downloads/VITALINK_GATE1_R2.vpk`, 41,233 bytes, SHA-256
`a84c1d05db90b11a782b0f319a0a998704cba8dc2de6d760a3557f3bda30ed64`.
The FTP download-back copy matched the local VPK byte-for-byte. Hardware display
acceptance still requires installing/reinstalling this R2 VPK and launching it.

### VitaLink Gate 1 R2 flicker/corrupted glyphs and R3 renderer replacement

Physical launch of `VITALINK_GATE1_R2.vpk` disproved the R2 display acceptance
claim: the screen showed rapidly flickering, structured white/yellow glyph-like
corruption rather than the probe UI. This was still a display-path failure, not a
Bluetooth result; R2 did not activate the radio or load the kernel scaffold.

Do not continue hand-maintaining a CPU-written single framebuffer for this probe.
R3 replaces that path completely with the proven `vita2d` renderer and default
Vita PGF font already used by the Prometheus Vita client: `vita2d_init`,
`vita2d_start_drawing`, `vita2d_clear_screen`, `vita2d_end_drawing`, and
`vita2d_swap_buffers`. This delegates buffer allocation, cache coherency, and swap
ownership to the established Vita rendering library instead of drawing into the
active scanout buffer. Button handling is edge-triggered so holding Cross does not
rewrite the report every frame.

Gate 1 R3 local package (2026-07-19): 66,100 bytes, SHA-256
`92c2ec023e55ed750ef870155ede3764f20931f909d3b2ac2635e955953f2125`.
The native VitaSDK build passed, uploader protocol tests passed 4/4,
`SHA256SUMS.txt` verified both artifacts, the VPK ZIP tested clean, and the packaged
128x128 palette icon decoded successfully. FTP upload/read-back verification passed
byte-for-byte on the physical Vita. Raul then installed and launched R3 on 2026-07-19;
the photographed hardware screen was stable and readable, showing the complete Gate 1
capability table with no black screen, flicker, or corrupted glyphs. This closes the
R3 renderer/hardware-display gate. It does not prove Bluetooth peripheral support:
the displayed `NOT LINKED / NO PUBLIC IMPORT` and `UNSUPPORTED (HONEST)` states are
deliberate static capability-boundary results from `src/bt_adapter.c`. Retrieve and
archive `ux0:data/vitalink-probe-report.txt` before moving to a provenance-backed
private adapter experiment.

R3 report retrieval completed over VitaShell FTP on 2026-07-19. The exact remote
file `ux0:/data/vitalink-probe-report.txt` was archived locally as
`reports/vitalink-probe-report-r3-2026-07-19.txt`: 1,116 bytes, SHA-256
`41930f6d795cae964f7a8ed105d67a9b53d774c1e8638891c2c2b68f991891b6`.
The report confirms `Renderer: vita2d`, successful initialization values, no linked
public Bluetooth import, and honest unsupported results for Classic HID peripheral,
discoverability/page scan, local identity/Class of Device, local SDP registration,
and a Classic L2CAP listener. Gate 1 is therefore complete: public VitaSDK does not
expose the capabilities needed by VitaLink. The next Bluetooth step must be a
provenance-backed private/kernel adapter investigation; do not infer hardware
impossibility from this public-API boundary, and do not install the existing log-only
kernel scaffold as though it exercised Bluetooth.

### Gate 2 passive kernel Bluetooth probe R1

Gate 2 begins with the narrowest safe private/kernel experiment. The plugin links
VitaSDK's documented reverse-engineered `SceBtForDriver_stub` and calls only
`ksceBtGetConfiguration()` plus `ksceBtGetLastError()`. It writes exact return
values to `ur0:data/vitalink/kernel-probe.txt`. It does **not** start inquiry,
change inquiry scan/page scan, pair, connect, register SDP, open L2CAP, or modify
Bluetooth configuration. This proves only that the kernel driver imports resolve
and can report passive state. Installation still requires explicit taiHEN config
staging, byte verification, and a reboot; FTP upload alone does not activate it.

Gate 2 R1 physical reboot check (2026-07-19): after a normal reboot the Vita reached
VitaShell and FTP normally, and read-back confirmed the active config still contains
`ur0:tai/vitalink_bt_probe_kernel.skprx`. The deployed SKPRX is byte-identical to the
local build: 4,582 bytes, SHA-256
`9c04056692d0311c99c44400a9b4561060c9ebd1db8fa972ac9287c583c6ae58`.
However, `ur0:/data/vitalink/kernel-probe.txt` was absent, as were the bounded fallback
paths checked. Therefore R1 did **not** prove that `module_start` executed or that the
`SceBtForDriver` calls ran. Treat this as a plugin-load/start failure, not a Bluetooth
capability result. Do not advance to discoverability or active radio mutations until a
diagnostic R2 records an unmistakable early-start marker and load-stage evidence.

### Gate 2 diagnostic kernel load probe R2

R2 isolates the R1 failure from Bluetooth itself. The plugin removes every
`SceBtForDriver` import and call and links only `SceIofilemgrForDriver_stub`. At the
first instruction path in `module_start`, it attempts to write the root marker
`ur0:data/vitalink-gate2-r2-start.txt`; it then attempts the nested report
`ur0:data/vitalink/kernel-probe-r2.txt`. Either file proves the kernel loader reached
`module_start`. Neither path changes Bluetooth or radio state.

Built R2 artifact: `deploy/vitalink_bt_probe_kernel.skprx`, 4,943 bytes, SHA-256
`bc3f0106afae9a6b78cdd7a58559c69723b3549ea770ff9f8a5c46181d61f0d5`.
Build completed cleanly with VitaSDK, and symbol inspection shows only the expected
`ksceIoOpen`, `ksceIoWrite`, `ksceIoClose`, and `ksceIoMkdir` driver imports; no
`ksceBt*` symbol remains. Replace the existing same-path R1 SKPRX over FTP, read it
back and verify the exact size/hash, then reboot normally. If neither marker exists
after reboot, the failure is before `module_start` or in the remaining filesystem
imports/config load. If the root marker exists but the nested report does not, the
failure is confined to nested-directory creation/open. Only restore Bluetooth imports
after R2 proves loader execution.

Gate 2 R2 physical reboot result (2026-07-19): **PASS**. After a normal reboot,
FTP retrieval found both independent markers. The root marker was 107 bytes,
SHA-256 `51ee1f9c19762ea5150b3db7a70e528d3d89ea9403abc15a0b7bb003d26809bd`,
and states `stage=module_start-entered`. The nested report was 245 bytes,
SHA-256 `6d3f513d2c2910d18c63bf36b76ff5103e98eb22b1ecc0c026e22203b91cdc47`,
and states `result=module_start-executed` and `mkdir=success-or-directory-created`.
The loaded `ur0:/tai/vitalink_bt_probe_kernel.skprx` read back as 4,943 bytes with
SHA-256 `bc3f0106afae9a6b78cdd7a58559c69723b3549ea770ff9f8a5c46181d61f0d5`,
an exact match to the local R2 build. This proves the config path, kernel loader,
`module_start`, and filesystem imports. It confines R1's failure to its
Bluetooth-linked form. No Bluetooth API was called and no radio state changed.
Archived evidence: `reports/vitalink-kernel-probe-gate2-r2-2026-07-19.txt`.

### Gate 2 passive single-import probe R3

R3 preserves R2's proven early filesystem marker, then restores exactly one passive
Bluetooth driver import and call: `ksceBtGetConfiguration()`. The pre-call marker is
`ur0:data/vitalink-gate2-r3-start.txt`; if the import resolves and the call returns,
R3 writes `ur0:data/vitalink/kernel-probe-r3.txt` with the exact 32-bit return value.
No last-error import is present, and R3 performs no inquiry, scan, pairing, connection,
SDP, L2CAP, configuration write, or other radio mutation.

Built R3 artifact: `deploy/vitalink_bt_probe_kernel.skprx`, 5,140 bytes, SHA-256
`972afdae5fcccc745a8f78a676f41db908dedb6f45e13b07e2ba478593bc9d17`.
The VitaSDK build passed. Linked-stub inspection shows the four already-proven
`ksceIo*` imports plus exactly one Bluetooth stub,
`SceBtForDriver_ksceBtGetConfiguration`; no other `ksceBt*` symbol is linked.
Deploy it over the existing same-path probe, retrieve and verify an exact match, then
reboot normally. A missing pre-call marker means this one import prevents module load;
a pre-call marker without the nested report means the call did not return; both files
mean the passive configuration read is viable.

R3 physical result (2026-07-19): PASS. After a normal reboot, both files were retrieved.
The pre-call marker was 150 bytes, SHA-256
`c16b8a689f3c58a6327c3018db54ad8c0cefd8962aed626fdd81350c873283a8`.
The result report was 222 bytes, SHA-256
`2275df9cb6209840b51cd6484d011bce5770cf56d872990fde5678005cd56443`,
and recorded `ksceBtGetConfiguration=0x00000000`. The deployed plugin remained an exact
5,140-byte match with SHA-256
`972afdae5fcccc745a8f78a676f41db908dedb6f45e13b07e2ba478593bc9d17`.
This proves the `SceBtForDriver_ksceBtGetConfiguration` import resolves and the passive
call returns. Per the VitaSDK header, `0x0` means Bluetooth was disabled at the instant
the boot-time probe ran; it does not indicate missing hardware or a failed import.

### Gate 2 passive status probe R4

R4 preserves R3 and adds exactly one passive status call, `ksceBtGetLastError()`, after
`ksceBtGetConfiguration()`. It writes `ur0:data/vitalink-gate2-r4-start.txt` before
both calls and `ur0:data/vitalink/kernel-probe-r4.txt` after both return. It performs
no inquiry, scan, pairing, connection, SDP, L2CAP, configuration write, or radio change.
Built artifact: `deploy/vitalink_bt_probe_kernel.skprx`, 5,303 bytes, SHA-256
`a02dc899f994467862fe250c244e73aaff5e4dc5c3242208656b7857500bea7f`.
Deployed to `ur0:/tai/vitalink_bt_probe_kernel.skprx` and independently retrieved over
a fresh FTP connection with an exact byte-for-byte match. Reboot normally, reopen FTP,
and retrieve the R4 marker/report before any active Bluetooth experiment.

R4 physical result (2026-07-19): **PASS**. After a normal reboot, the pre-call marker
was retrieved at 166 bytes, SHA-256
`cd2ab064b6aa61fd00fbd9d72cfa7b12d2a626a601727bb6b78a9a3857d624d0`. The result
report was 274 bytes, SHA-256
`dc2cdf06fc16b7f5d4dd7d9667ce34928339831eed70171037b836841f90c44f`, and recorded
`ksceBtGetConfiguration=0x00000000` and `ksceBtGetLastError=0x00000000`. The deployed
plugin remained an exact 5,303-byte match with SHA-256
`a02dc899f994467862fe250c244e73aaff5e4dc5c3242208656b7857500bea7f`. This proves
both passive imports resolve and return cleanly. Bluetooth was still disabled when the
boot-time calls ran; the zero last-error value gives no evidence of an API failure.

### Gate 2 delayed passive status probe R5

R5 addresses the remaining timing ambiguity without changing Bluetooth state. It keeps
R4's immediate passive reads, then starts a kernel worker that appends 12 additional
`ksceBtGetConfiguration()` and `ksceBtGetLastError()` samples at 10-second intervals.
This creates a two-minute observation window in which Bluetooth can finish initializing
or be toggled manually from Settings. R5 performs no inquiry, scan, pairing, connection,
SDP, L2CAP, configuration write, or radio mutation.

Built R5 artifact: `deploy/vitalink_bt_probe_kernel.skprx`, 6,183 bytes, SHA-256
`f16670da1e93a58ab8b9107ddf2b8e350a47fdb7e76fa37092d0392ee0ced1f8`. It links only
R4's two passive `SceBtForDriver` calls plus the kernel thread lifecycle/delay imports.
It was deployed to `ur0:/tai/vitalink_bt_probe_kernel.skprx` and independently retrieved
over a fresh FTP connection with an exact byte-for-byte match. Reboot normally, make
sure Bluetooth is enabled in Settings after boot, wait at least two minutes, then reopen
VitaShell FTP and retrieve `ur0:data/vitalink/kernel-probe-r5.txt`.

R5 physical result (2026-07-19): **PASS**. Retrieved the start marker at 141 bytes,
SHA-256 `ae8fcddbeb3e9634cec878f85ef0a9da3f28b6fa4ea267acabf1830de6bb1705`, and the
completed 12-sample report at 1,248 bytes, SHA-256
`d10dee7b9f1033b416d5843df546b85b6d8cc6af6cfe781627c81dd18bac7d97`.
The deployed plugin remained an exact 6,183-byte match with SHA-256
`f16670da1e93a58ab8b9107ddf2b8e350a47fdb7e76fa37092d0392ee0ced1f8`.
Samples show the real transition after Bluetooth was enabled manually: sample 1 was
configuration `0x0` with last error `0x0`; samples 2-8 reported transitional configuration
`0x40` with `SCE_BT_ERROR_CONF_SUSPEND_TIMEOUT` (`0x802F150F`); samples 9-12 stabilized
at configuration `0x9` with last error `0x0`. VitaSDK documents `0x9` as enabled. This
proves Bluetooth initializes and remains passively queryable; the temporary timeout is a
configuration-transition status, not a failed plugin/import. Gate 2 passive-read validation
is complete. Do not infer discoverability or HID-peripheral capability from this result.

### Gate 2 inquiry-scan import probe R6

R6 advances only the loader boundary toward discoverability. It preserves passive
`ksceBtGetConfiguration()` / `ksceBtGetLastError()` reads and links
`ksceBtSetInquiryScan(int)`, but deliberately does **not** call it. This distinguishes
whether the target driver export resolves on retail firmware before any radio-visible
state is changed. The probe writes `ur0:data/vitalink-gate2-r6-start.txt` and
`ur0:data/vitalink/kernel-probe-r6.txt`; both state that inquiry scan was not called.

Built artifact: `deploy/vitalink_bt_probe_kernel.skprx`, 5,444 bytes, SHA-256
`45cec6d17da4f29c6d018963bcc702d37d3851556cd991f0cabd8afa85a5e48a`. ELF inspection
confirmed imports for `ksceBtGetConfiguration`, `ksceBtGetLastError`, and
`ksceBtSetInquiryScan`. Deployed to `ur0:/tai/vitalink_bt_probe_kernel.skprx` and
retrieved over a fresh FTP connection with an exact byte-for-byte match. A normal reboot
is required to test the import. This build performs no inquiry scan, inquiry, pairing,
connection, SDP, L2CAP, configuration write, or radio mutation.

Research boundary before any R7 active call: public VitaSDK sources expose
`int ksceBtSetInquiryScan(int)` from `SceBtForDriver` (NID `0x4F5A852E`) but define no
argument constants, return-code contract, or public known caller. The name strongly maps
to Bluetooth Classic Inquiry Scan (discoverability), not page scan/connectability, HID
service advertisement, pairing, or a listening endpoint. `0`/`1` are plausible disable/
enable values but remain unproven. Any later R7 experiment must therefore be visibility-only,
time-bounded, and reversible: first establish a baseline Classic inquiry, call only value `1`,
log the direct result, allow a short discovery window, always attempt value `0` cleanup, and
stop on a negative return, unexpected pairing prompt, Bluetooth UI instability, or existing
connection disruption. Do not call `ksceBtSetConfiguration`, arbitrary values, inquiry,
pairing, SDP, L2CAP, or connection APIs in that experiment. Normal phone settings may
filter unknown Classic devices, so absence there alone is not definitive evidence.

### Gate 2 bounded inquiry-scan visibility probe R7

R6 physical reboot result (2026-07-19): **PASS**. Retrieved the start marker at
137 bytes, SHA-256 `e804967743314b545ae1abd75fa5b495f9c159117284b08eaab481af7dca8961`,
and the report at 373 bytes, SHA-256
`bf97a943d90be4ba43837236c77d3b9ae1ad13675b43bf8e12f6b1946832f8eb`.
The report proves `ksceBtSetInquiryScan` resolved at runtime (recorded pointer
`0x019212a0`) while remaining uncalled. Bluetooth configuration was `0x19` and
last error `0x0`. The retrieved plugin exactly matched the local 5,444-byte R6
artifact, SHA-256 `45cec6d17da4f29c6d018963bcc702d37d3851556cd991f0cabd8afa85a5e48a`.

R7 is the first active, visibility-only experiment. It waits 30 seconds after boot,
then calls only `ksceBtSetInquiryScan(1)`, records the direct result, leaves the
Classic inquiry visibility window open for at most 90 seconds if the call succeeds,
and always calls `ksceBtSetInquiryScan(0)` for cleanup. It performs no pairing,
connection, SDP, HID, L2CAP, inquiry initiation, or Bluetooth configuration write.
The root marker is `ur0:data/vitalink-gate2-r7-start.txt`; the rolling/final report
is `ur0:data/vitalink/kernel-probe-r7.txt`.

Built R7 artifact: `deploy/vitalink_bt_probe_kernel.skprx`, 6,194 bytes, SHA-256
`2327e77544e091d5a632307e29a220e5e2ab8c3c0c997e63191cc1d587695370`.
ELF inspection confirmed the expected Bluetooth passive/status, inquiry-scan, and
kernel thread/delay imports. It was deployed to
`ur0:/tai/vitalink_bt_probe_kernel.skprx`, then retrieved over a fresh FTP
connection with an exact byte-for-byte match. Physical execution still requires a
normal reboot. During the 90-second window, use an independent Bluetooth Classic
scanner if available; iPhone Settings alone may filter unnamed/unknown Classic
devices. After at least two minutes, reopen VitaShell FTP and retrieve both R7
markers to prove the direct enable result and automatic disable cleanup.

R7 physical result (2026-07-19): **PASS, with unexpected pairing-path evidence**. After
the bounded visibility window, the final report was retrieved at 450 bytes, SHA-256
`36b8dd355d61f9482fd16b5fdd21f4e04a30cd415717ab1b74feeeeb3da8ee56`. It records
Bluetooth configuration `0x00000009`, last error `0x00000000`,
`ksceBtSetInquiryScan(1)=0x00000000`, and automatic
`ksceBtSetInquiryScan(0)=0x00000000`; therefore both enable and cleanup succeeded. The
189-byte start marker has SHA-256
`a4fa415f4034dc1f544e53968cd52dd05a023623af4697690b0fe375a072b293`. The deployed
SKPRX remained an exact 6,194-byte match with SHA-256
`2327e77544e091d5a632307e29a220e5e2ab8c3c0c997e63191cc1d587695370`.

During the active window, a stock iPhone displayed the Vita by its real name,
`PlayStation Vita`. Selecting it caused iOS to open a Bluetooth Pairing Request using
six-digit numeric comparison code `395927`, explicitly asking the user to confirm that
the same code was shown on `PlayStation Vita`. The iPhone-side screenshot is archived at
`reports/r7-retrieval/iphone-ios-pairing-request-395927.png`. The user pressed Pair on
iOS, but VitaShell FTP was foreground and no confirmation surface appeared on the Vita;
no completed bond or connection is claimed. This proves substantially more than passive
discovery: the iPhone could identify the Vita and initiate a Bluetooth Classic Secure
Simple Pairing exchange far enough to generate numeric comparison. It does **not** yet
prove that a homebrew plugin can accept pairing, advertise HID, or be recognized by iOS
or COD Mobile as a controller.

Before an R8 code change, test the existing system pairing UI rather than adding unknown
active APIs: run the same bounded visibility probe while the Vita's Settings Bluetooth
Devices page is foreground instead of VitaShell, then select the Vita from iOS and check
whether the Vita presents the matching numeric-comparison confirmation. The first pass is
observation-only: do not confirm on either device; record whether the same code appears,
then cancel on iPhone or let the request time out. Because FTP cannot remain foreground
for that observation, retrieve the same automatic-cleanup report only after the attempt.
If the stock UI still presents no confirmation, stop and passively characterize
`ksceBtRegisterCallback` / `ksceBtReadEvent` traffic before attempting reply, pairing,
SDP, HID, L2CAP, or configuration APIs from homebrew.

R8 stock-system pairing-UI physical result (2026-07-19): **PASS for bilateral
numeric-comparison presentation; intentionally canceled before bonding**. With the
Vita's Settings -> Devices -> Bluetooth Devices page foregrounded during the existing
bounded R7 inquiry-scan window, iOS again initiated pairing and the Vita displayed the
matching six-digit key in its native confirmation notification. The user deliberately
canceled on both devices; the subsequent Vita `An error has occurred` result is therefore
expected cancellation behavior, not evidence of a failed capability. No persistent bond,
connection, HID service, iOS controller classification, or COD Mobile recognition is
claimed.

Post-R8 FTP preservation re-retrieved the unchanged R7 evidence. Final report: 450 bytes,
SHA-256 `36b8dd355d61f9482fd16b5fdd21f4e04a30cd415717ab1b74feeeeb3da8ee56`, with
`ksceBtSetInquiryScan(1)=0x00000000`, `ksceBtSetInquiryScan(0)=0x00000000`, and
`stage=cleanup-complete`. Start marker: 189 bytes, SHA-256
`a4fa415f4034dc1f544e53968cd52dd05a023623af4697690b0fe375a072b293`. Deployed
SKPRX: 6,194 bytes, SHA-256
`2327e77544e091d5a632307e29a220e5e2ab8c3c0c997e63191cc1d587695370`, still an
exact local match. The archived iPhone pairing screenshot is 1,139,064 bytes, SHA-256
`de16f31d540c0b94603db48e490c5e943e905fe00523d709fad6247171e688e2`.

This closes the need for an R9 raw security-event recorder before the next test: Sony's
stock Bluetooth UI demonstrably owns and presents the Vita-side confirmation. The next
bounded physical gate is to repeat the same system-UI flow, verify the numeric codes match,
then explicitly confirm on both devices and observe whether a persistent bond completes.
Do not change the kernel plugin for that test. Afterward, retrieve the unchanged R7 cleanup
report and inspect both devices' paired/connected state. Even a successful bond will not
prove HID advertisement or game-controller recognition; those remain separate gates.

R8 bond-completion physical result (2026-07-19): **FAIL after bilateral numeric confirmation**. On a clean repeat with the Vita stock Bluetooth Devices page foregrounded, iOS and the Vita displayed the same six-digit Secure Simple Pairing numeric-comparison value. The user selected Pair on both devices. The Vita then immediately displayed `An error has occurred`; no successful persistent bond or connection was observed. This rules out discovery and pre-confirmation numeric comparison as the failure point. The remaining boundary is either link-key/bond registration completion or the immediately following service/profile policy check. Do not claim which one without instrumentation.

Post-attempt FTP preservation again retrieved the unchanged R7 report and deployed plugin. Report: 450 bytes, SHA-256 `36b8dd355d61f9482fd16b5fdd21f4e04a30cd415717ab1b74feeeeb3da8ee56`, `stage=cleanup-complete`, Bluetooth configuration `0x00000009`, last error `0x00000000`, and successful inquiry enable/disable cleanup. Start marker: 189 bytes, SHA-256 `a4fa415f4034dc1f544e53968cd52dd05a023623af4697690b0fe375a072b293`. Deployed R7 SKPRX: 6,194 bytes, SHA-256 `2327e77544e091d5a632307e29a220e5e2ab8c3c0c997e63191cc1d587695370`.

The next bounded diagnostic must remain observation-only: capture time-local `ksceBtGetLastError()` changes and enumerate registered-device state before/during/after one pairing attempt. Do not call `ksceBtReplyUserConfirmation`, `ksceBtReplyPinCode`, delete registration, SDP, HID, L2CAP, connect, or configuration-write APIs. Event callback/read instrumentation is deferred until its callback ownership and non-interference with Sony's stock Settings UI are proven.

R9 observation-only pairing-boundary probe built and deployed after the R8 failure. It retains the proven bounded inquiry visibility call, samples `ksceBtGetLastError()` every 250 ms for 120 seconds, performs guaranteed inquiry-disable cleanup, then passively enumerates up to 16 registered-device slots with `ksceBtGetRegisteredInfo`. It does not register/read callbacks and makes no confirmation reply, PIN reply, connect, delete, SDP, HID, L2CAP, or Bluetooth configuration-write calls. Deployed `ur0:/tai/vitalink_bt_probe_kernel.skprx`: 7,277 bytes, SHA-256 `c624b42515d4fa90dad9ec721191ee9fd3debee094874f30de9d1017cab0ea91`; fresh FTP readback is an exact byte-for-byte match. A reboot is required before R9 runs.

R9 physical result (2026-07-19): **no persistent bond and no diagnostic state exposed by the passive APIs**. The stock Vita Bluetooth UI again displayed `An error has occurred` immediately after bilateral approval of the matching numeric-comparison code; the iPhone displayed no follow-up error but did not connect or retain a usable pairing. Photo evidence is preserved at `uploads/IMG_7075.jpeg` (6,881,076 bytes, SHA-256 `e3bb4f8df75806d3c3b652ee82d4a22b26a18dfb6f1fc688fcab305cccd1c45a`) and visibly records the Vita error.

R9 FTP evidence was retrieved after the attempt. Start marker: 253 bytes, SHA-256 `04bfece883967981cfb8b185b770a145c03d3082c6473902049f251503eb4bf5`. Final report: 2,233 bytes, SHA-256 `ab6a1db0bb7f3a03f6a602b684fafe7e4dd2e7d28a40f5e685105912b1ce0bd5`. The report records Bluetooth configuration `0x00000009`, successful inquiry enable and cleanup (`0x00000000`), no observed `ksceBtGetLastError()` transition from zero, and no nonzero registered-device record in slots 0 through 15. The deployed R9 SKPRX remained an exact 7,277-byte match with SHA-256 `c624b42515d4fa90dad9ec721191ee9fd3debee094874f30de9d1017cab0ea91`. Therefore the failure occurs before a persistent registration survives, but R9 cannot distinguish link-key rollback from immediate unsupported-profile/service policy rejection.

Public `xerpi/ds4vita` evidence confirms the mechanics of `ksceBtRegisterCallback` plus callback-triggered `ksceBtReadEvent`, including `SceBtEvent` raw 16-byte records, but does not prove that event reads are independently queued or non-destructive alongside Sony Settings. Callback/event draining remains deferred because it could steal security events or alter native pairing timing.

R10 high-resolution observation-only probe was built and deployed next. It keeps the proven bounded inquiry enable/disable pair, samples `ksceBtGetLastError()` and `ksceBtGetConfiguration()` every 50 ms for 90 seconds, and enumerates registered-device state every second to catch transient registration followed by rollback. It does not register callbacks, read events, reply to pairing, connect, delete, advertise SDP/HID, use L2CAP, or write Bluetooth configuration. Deployed `ur0:/tai/vitalink_bt_probe_kernel.skprx`: 8,536 bytes, SHA-256 `3de0fb92e4e05af5a9158c3a6686a2c07d7ed4b343297258d4d3ebf627e30c4b`; fresh FTP readback is an exact byte-for-byte match. A normal reboot is required before R10 runs.

R10 physical result and retrieval (2026-07-19): **no transient registration was observed**. During another bilateral numeric-comparison attempt, the Vita again reported `An error has occurred` and iOS silently abandoned the attempt. The 50 ms error/configuration stream remained at error `0x00000000` and configuration `0x00000009`; every one-second registered-device snapshot was empty, including the final post-cleanup snapshot. Report: `reports/r10-retrieval/kernel-probe-r10.txt`, 23,721 bytes, SHA-256 `68c65d643b2456a23319b82d7fcdb35a14d46404780630e42df3c01274e18a19`. Start marker: 275 bytes, SHA-256 `e1979f7b9fbcfb02a09ba13a2290b6120189d94d882703bf795c4ef9474b1fa4`. Deployed R10 SKPRX remained an exact 8,536-byte match with SHA-256 `3de0fb92e4e05af5a9158c3a6686a2c07d7ed4b343297258d4d3ebf627e30c4b`. This rules out a registration that persists for one second or longer, but it does not identify the rejected security/profile stage.

R11 callback-notification observer was built and deployed next. This is deliberately narrower than a raw event recorder: it registers the same broad Bluetooth notification callback pattern demonstrated by public `xerpi/ds4vita`, but **never calls `ksceBtReadEvent`**. It records only callback invocation metadata (`notifyId`, `notifyCount`, `notifyArg`, callback common value, 100 ms observation tick, last error, and configuration), preserving Sony Settings as the native pairing-confirmation owner and avoiding event-queue consumption. It retains the bounded 30-second delay, 90-second inquiry window, automatic inquiry disable, callback unregister/delete cleanup, and makes no pairing reply, connection, deletion, SDP, HID, L2CAP, or Bluetooth configuration-write calls. Deployed `ur0:/tai/vitalink_bt_probe_kernel.skprx`: 7,306 bytes, SHA-256 `0535bb869b2241040dc5196d381ca7b3b47b87fe6fe9acfb9b639d8279c74617`; fresh FTP readback is an exact byte-for-byte match. A normal reboot is required before R11 runs.

R11 physical result and retrieval (2026-07-19): **callback registration and delivery PASS; raw event ownership remains unproven**. The observer registered successfully (`ksceBtRegisterCallback=0x00000000`), enabled and disabled inquiry cleanly, unregistered cleanly, retained Bluetooth configuration `0x00000009`, and recorded no Bluetooth last-error transition. It received eight callback notifications during the bounded run. Every callback carried generic metadata (`notify-id=0xffffffff`, `notify-count=1`, `notify-arg=0`, `common=0`), at 100 ms ticks `0x2e`, `0x3d`, `0x4a`, `0x51`, `0x71`, `0xe2` twice, and `0x199`. Report: `reports/r11-retrieval/kernel-probe-r11.txt`, 2,136 bytes, SHA-256 `78d27ebe8ea70ab474ea1dae4d6d9c7bce6fc2a620664d0a0520a98f7b77c0ab`. Start marker: 240 bytes, SHA-256 `8f935067b6e2048b3a31e1101a44b228f41359471b3cebe3756e5401aa65472f`. Deployed SKPRX remained an exact 7,306-byte match with SHA-256 `0535bb869b2241040dc5196d381ca7b3b47b87fe6fe9acfb9b639d8279c74617`.

Do **not** infer event types from R11's generic callback metadata, and do not deploy a pairing-time `ksceBtReadEvent` drain merely because callback delivery works. Public DS4Vita proves that reading 16-byte `SceBtEvent` records from this callback is mechanically possible, but its implementation drains the queue and does not establish whether events are duplicated per client or globally consumed. A reader running alongside Sony Settings could steal or delay the security event and manufacture the pairing failure being diagnosed. Any future raw-read experiment must first be a separate queue-ownership safety gate with no pairing attempt or Settings Bluetooth page, at most one read per callback, fixed preallocated records, no callback-time file I/O, strict caps, and deterministic unregister/cleanup. No R12 was deployed at this point because a no-pairing read would not yet explain the bond rejection and a pairing-time read is not proven observationally safe.























For recovery-only plugin transfer, upload to the exact fixed paths under
`ur0:/tai/`, read the same path back, compare size and SHA-256, then reboot.
Never infer a successful plugin load merely from a successful FTP write.

## What requires a reboot

- Replacing or adding `.skprx` kernel plugins: yes.
- Replacing the loaded `prometheus_vita_control.suprx`: use a reboot.
- Editing active taiHEN config: reboot (or the documented taiHEN refresh where
  appropriate, but reboot is the reliable workflow used here).
- Installing/reinstalling a VPK such as Figure 8: no reboot; close/relaunch it.
- Uploading a VPK without installing it: no reboot, but it changes nothing in
  the installed game until VitaShell installation or backend promotion occurs.

## VitaLink boundary

VitaLink's `vitalink_bt_probe_kernel.skprx` is a separate log-only research
plugin. Do not send it to `/update-kernel-plugin`: that endpoint always targets
`prometheus_vita_input.skprx`. Stage the VitaLink probe under its own filename,
back up config, add its own `*KERNEL` entry once, reboot, and use the L-at-boot
recovery path. The current public VitaSDK capability probe does not establish a
working iPhone Bluetooth HID link.



### R12 static event-ownership audit and read-only firmware retrieval (2026-07-19)

R12 did not deploy a new probe or call `ksceBtReadEvent`. R11 proved callback registration,
delivery, unregistration, and deletion (eight generic `notify-id=0xffffffff` callbacks), but
not the ownership or duplication semantics of the event queue the callback signals. Public
`xerpi/ds4vita` uses `ksceBtReadEvent(&hid_event, 1)` as a queue-draining controller path,
then handles event `0x04` with a confirmation reply. It is therefore not safe to copy into Sony
Settings pairing: there is no proof of an independent third-party queue.

R12 then used the already-open VitaShell FTP service at `10.0.0.231:1337` for **read-only**
`LIST`, `CWD`, and `RETR` requests only—no upload, delete, rename, config, plugin, bond, or
radio operation. Root listing exposed `vs0:`. Sequential `CWD vs0:` → `app` exposed 56
system-app IDs, while `CWD vs0:` → `sys` → `external` exposed 141 modules. This corrects the
FTP syntax finding: absolute/path-qualified `LIST`/`CWD` fails, but component-by-component
navigation works. `NPXS10015` is visible under `vs0:/app`, but its child directory and direct
`eboot.bin` retrieval returned `550`; R12 therefore did not obtain the Settings caller.

The actual `os0:/kd` listing contains `wlanbt_robin_img_ax.skprx`, which R12 retrieved
read-only: `os0:/kd/wlanbt_robin_img_ax.skprx`, **310,941 bytes**, SHA-256
`927786e1737a6c515b706c34155884ed74e17fd563a2a52523834ecf363f5a3a`, preserved in
`reports/r12-firmware-retrieval/`. It is a signed `SCE\0` wrapper with an embedded 310,781-byte
ARM ELF at offset 160 (SHA-256
`053f5434e3a655ce4ebefc1fcbf8c71a80f0f7719f420030b7d8f092d1fb9e01`). Native `readelf`
identifies the embedded image as ARM ELF32 type `0xfe04`, three program headers, and no section
headers or dynamic section; plaintext searches contain no `SceBt`, `ksceBt`, `Bluetooth`,
`HID`, `L2CAP`, `RegisterCallback`, or `ReadEvent`. This is concrete firmware-matched
Bluetooth/WLAN-image evidence, but not a safe basis to infer queue ownership or call semantics.

A separately retrieved executable `vs0:/app/NPXS10026/eboot.bin` is **Content Manager**
(`NPXS10026`) rather than Settings: 517,373 bytes, SHA-256
`f4e1b7eecdae0289365c9415967f8dea076e463f38cf781d987ab2cf2439b951`. Its PARAM.SFO is
5,132 bytes, SHA-256 `7b7b006a53c7c4139dca8fa0a45e07a9c25357f57f972fe2d8da807e71243707`.

The full audit, retrieval manifests, container analysis, and PARAM.SFO parsing are in
[`reports/r12-static-event-ownership-audit-2026-07-19.md`](reports/r12-static-event-ownership-audit-2026-07-19.md)
and `reports/r12-firmware-retrieval/`. The next safe gate is offline disassembly of the extracted
`wlanbt` PT_LOAD segments and read-only retrieval of the Settings executable using sequential
component CWD/RETR. Trace `ksceBtRegisterCallback` and `ksceBtReadEvent` only after a matching
caller/import is obtained. Only direct proof of a per-registration queue or broadcast/ref-counted
stream can justify a later reply-free reader. Until then, no event reads during Settings pairing,
no pairing/PIN replies, connect, deletion, SDP/HID/L2CAP, configuration writes, advertisements,
or new plugin installation.


## R13 static feasibility decision (2026-07-19)

R13 was offline-only and made **no FTP request** so the open VitaShell session, installed R11 plugin, Settings pairing state, and radio state remained untouched. The exact recovered radio-side image remains `os0:/kd/wlanbt_robin_img_ax.skprx` (310,941 bytes, SHA-256 `927786e1737a6c515b706c34155884ed74e17fd563a2a52523834ecf363f5a3a`); its embedded ELF begins at wrapper offset `0xA0`, is 310,781 bytes (SHA-256 `053f5434e3a655ce4ebefc1fcbf8c71a80f0f7719f420030b7d8f092d1fb9e01`), and is ARM ELF32/EABI5 type `0xfe04` with program header offset `0x34`, three program headers, no section headers, no dynamic section, and no dynamic symbols. This does not yield named `SceBtForDriver` exports, NIDs, or a queue-owner offset.

The project’s only verified Bluetooth caller boundary is the R11 plugin: it registers `ksceBtRegisterCallback(callback_uid, 0, 0xffffffff, 0xffffffff)` at `plugin/main.c:130–136`, logs only callback metadata at `52–67`, and unregisters/deletes at `103–115`; it does not call `ksceBtReadEvent`. The matching stock Settings caller (`NPXS10015`) could not be retrieved in R12, so no Settings import NID/call offset is available. R11's eight generic callback notifications prove wakeup delivery only—not an event payload, per-subscriber queue, or event duplication.

**R13 decision:** do not build or deploy an event-reader probe. `ksceBtReadEvent` remains potentially global/destructive, and it is forbidden while Sony Settings owns pairing. The next target is an exact matching, read-only export of `SceBtForDriver` plus `NPXS10015` and its Bluetooth submodule/import table. Offline trace must resolve both import NIDs, callback-registration ownership, queue pointer/field offset, and the actual dequeue primitive. Only a proven per-registration/process queue or broadcast/ref-counted stream can justify a reply-free reader. A global queue requires a non-consuming import/callback trace instead. No R13 result proves a local HID advertisement/profile capability.

See `reports/r13-feasibility-2026-07-19/R13_STATIC_FEASIBILITY.md` and `artifact-checksums.txt` for the full evidence ledger and reproducible checks.
