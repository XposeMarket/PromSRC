# Prometheus workflow: inspect, edit, preview, build, and deliver Figure 8

This file is the short operational loop for Prometheus or any coding agent
working on the Vita game. Read `AGENTS.md` for hardware-control and recovery
details. Read [`VITA_LINK_DEPLOYMENT.md`](VITA_LINK_DEPLOYMENT.md) for the
condensed game deployment handoff and
[`../vitalink-vita/VITA_SYSTEM_RUNBOOK.md`](../vitalink-vita/VITA_SYSTEM_RUNBOOK.md)
for the complete kernel/plugin and Wi-Fi architecture.

## Source of truth

- Game and city implementation: `src/main.cpp`
- Generated Vita package: `build-v04/figure8_vita.vpk`
- Local city renderer: `tools/city_preview.py`
- Structural layout check: `tools/check_city_layout.py`
- System-wide Vita bridge: `../prometheus-vita/pc-bridge/control-server.mjs`

Do not edit a second copy of the city for the preview. The preview parses the
road, curve, building, highway, ramp, and industrial arrays directly from
`src/main.cpp`, so a source edit appears in the next local render.

## Fast local computer loop

Run from this directory in PowerShell:

```powershell
python -m pip install -r requirements-preview.txt
python tools/check_city_layout.py
python tools/city_preview.py --view topdown --snapshot build-v04/city-topdown.png
python tools/city_preview.py --view overview --snapshot build-v04/city-overview.png
python tools/city_preview.py --view underpass --snapshot build-v04/city-underpass.png
```

Open the PNG files to inspect the result, or launch the interactive fly camera:

```powershell
.\preview-city.ps1
```

Controls are W/A/S/D, Q/E, arrow keys, Shift, and Escape.

The local renderer is a geometry/layout preview, not a Vita emulator. It is
appropriate for checking:

- road continuity and widths
- building/road overlap
- bridge position and underpass clearance
- hills, ramps, ponds, warehouses, and district scale

It does not prove Vita frame rate, controller feel, texture loading, UI, weapon
behavior, or exact vitaGL rendering. Those still require a Vita build and a
hardware smoke test.

## Editing rules that prevent recurring map bugs

1. Add ground roads to `CITY_EXTENDED_ROADS` or a Catmull-Rom control array.
2. Add every new curve to `cityGroundRoadDistance`, `drawCity`, the minimap, and
   `tools/city_preview.py`.
3. Keep the elevated highway out of `cityGroundRoadDistance`; its surface is
   selected only while `carOnHighway` or `personOnHighway` is true. This keeps
   underpasses driveable.
4. Run `python tools/check_city_layout.py` after moving any building or obstacle.
5. Render both `topdown` and `underpass` before building.
6. Do not change approved driving physics unless the user explicitly asks.

## Build

```powershell
& 'C:\msys64\usr\bin\bash.exe' -lc 'export VITASDK=/usr/local/vitasdk; export PATH="$VITASDK/bin:/usr/bin:$PATH"; /usr/bin/cmake --build /c/Users/rafel/PromSRC/workspace/games/figure-8-drift-vita/build-v04 -j4'
Get-Item build-v04/figure8_vita.vpk
Get-FileHash build-v04/figure8_vita.vpk -Algorithm SHA256
```

### Windows Application Control / `collect2.exe` recovery

On this machine, Windows Application Control can begin blocking VitaSDK's unsigned
`collect2.exe` even when the same MSYS2 build worked the previous day. The exact
symptom is GCC reporting `cannot execute .../collect2.exe: CreateProcess: No such
file or directory`; Code Integrity events 3033/3077 identify the real signing-policy
block. Do not misdiagnose this as a missing VitaSDK file.

A policy-compatible replacement can be built from the tracked shim source:

```powershell
$project = (Resolve-Path .).Path
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
cmd /d /c "`"$vcvars`" >nul && cl /nologo /O2 /Fe:`"$project\tools\vita-link-shim\collect2.exe`" `"$project\tools\vita-link-shim\collect2.c`""
$gccDir = 'C:\msys64\usr\local\vitasdk\lib\gcc\arm-vita-eabi\15.2.0'
if (!(Test-Path "$gccDir\collect2.vitasdk-original.exe")) { Copy-Item "$gccDir\collect2.exe" "$gccDir\collect2.vitasdk-original.exe" }
Copy-Item "$project\tools\vita-link-shim\collect2.exe" "$gccDir\collect2.exe" -Force
.\build-vita.sh
```

The shim forwards GCC's linker arguments directly to `arm-vita-eabi-ld.exe`; keep
the original binary backup. Verify the resulting VPK entries, size, SHA-256, and
hardware behavior before deployment. Historical commands and outcomes can also
be reconstructed from `workspace/audit/chats/transcripts/` when notes are incomplete.


## Deliver and test

Prefer the backend install endpoint documented in `AGENTS.md`. Use upload-only
or FTP only when direct installation is unavailable. Never claim the Vita was
updated until the install response succeeds or the remote FTP copy has been
verified.

### Vita app presentation assets

Package the home-screen icon as `sce_sys/icon0.png` (128×128 PNG). A custom
LiveArea uses `sce_sys/livearea/contents/template.xml` plus its referenced
background/startup PNGs. **Every packaged shell PNG must be an indexed 8-bit
palette (`P`) PNG, not a normal RGB/24-bit PNG.** VitaShell reaches 99% and fails
with `0x8010113D` when otherwise valid RGB artwork is present. Quantize `icon0.png`,
the 840×500 background, and the 280×158 startup image to at most 256 colors, then
verify their decoded mode is `P` from the built VPK itself. Keep editable/generated
source art under `assets/`, list every packaged file explicitly in
`vita_create_vpk`, then inspect the VPK archive before deployment. Reinstalling
the VPK refreshes these shell assets; a plain `eboot.bin` swap does not.

The VitaLink Gate 1 failure on 2026-07-18 added a stricter preflight: do not rely
on dimensions/mode metadata alone. Fully decode/verify every source PNG, then
extract and decode it again from the completed VPK. A malformed RGB 128×128 PNG
passed packaging but produced the same `0x8010113D`; replacing it with a valid
8-bit palette PNG fixed the package. See
`../vitalink-vita/VITA_SYSTEM_RUNBOOK.md` for the verified incident record.


### Aircraft hardware smoke

On Vita hardware, enter the plane and verify **R accelerates immediately** and
**L visibly brakes on the runway**. The aircraft HUD includes `THR n%`: holding R
must make it rise toward 100%, which distinguishes input detection from physics.
Build speed, then pull back on the right stick or hold **Cross** as the accessible
alternate rotate control. Ground-contact damping must run only on the transition
from airborne to grounded; never apply velocity damping every frame merely because
`plane.y <= 0`, or it will erase runway acceleration and make R appear dead. Do not
treat static source checks as proof of flight controls; this requires a hardware pass.


After installation, test the changed district on hardware. A good city smoke
test covers ground driving beneath the highway, entering and leaving every ramp,
the full elevated loop, curb/grass transitions, roundabout centers, building
collisions, and the new industrial loading yards.
