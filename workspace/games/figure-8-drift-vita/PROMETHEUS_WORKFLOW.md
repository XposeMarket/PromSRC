# Prometheus workflow: inspect, edit, preview, build, and deliver Figure 8

This file is the short operational loop for Prometheus or any coding agent
working on the Vita game. Read `AGENTS.md` for hardware-control and recovery
details.

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

## Deliver and test

Prefer the backend install endpoint documented in `AGENTS.md`. Use upload-only
or FTP only when direct installation is unavailable. Never claim the Vita was
updated until the install response succeeds or the remote FTP copy has been
verified.

After installation, test the changed district on hardware. A good city smoke
test covers ground driving beneath the highway, entering and leaving every ramp,
the full elevated loop, curb/grass transitions, roundabout centers, building
collisions, and the new industrial loading yards.
