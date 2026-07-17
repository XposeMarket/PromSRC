# Figure 8 Drift — PS Vita Port

Native PS Vita port of the browser game in `../figure-8-drift/`.

For agents working with the real Vita hardware, read [`AGENTS.md`](AGENTS.md) first. It documents system-wide Wi-Fi control, live screen viewing, direct backend installation, FTP/plugin updates, recovery, and the hardware-specific navigation quirks confirmed on this Vita.

This is not a webpage wrapper. The Vita's browser cannot run the game's modern Three.js/WebGL module stack reliably, so the first Vita build recreates the core game in C++ with VitaSDK + vitaGL:

- native 960×544 hardware-accelerated 3D
- analog-stick steering
- Right trigger (R) to accelerate
- Left trigger (L) to brake/reverse
- Circle to lock/release rear grip and initiate a drift; throttle does not add speed until the handbrake is released
- Triangle to reset
- Start to return to the main menu
- figure-8 track, chase camera, road/off-road grip, drift score/combo physics
- readable score/speed/combo HUD
- touchscreen top-left HUD card that toggles between score information and a live minimap
- custom track builder with save/load and selectable 10 m / 16 m / 24 m turn radii (highlight **TURN RADIUS**, then Left/Right)
- six independent custom-track save slots with overwrite confirmation
- City Drive mode with roads, buildings, street furniture, and solid collisions
- five Select-button camera angles, including body-attached hood and cockpit views, with building-aware chase-camera avoidance (the Wi-Fi bridge exposes **SELECT** beside Start; its API name is `select`)
- persistent Customize menu with three shared-physics vehicle bodies, body/stripe palettes, wheel styles, and a live preview
- Square to exit/enter the vehicle; on-foot third/first-person cameras with right-stick free look, X jump, D-pad Down run, and solid building collision
- unlimited rocket launcher and machine gun, switched with Triangle while on foot
- destructible building facade panels with launch/impact explosions
- knockable lamps, benches, bus stops, stop signs, traffic lights, and street signs that react to cars, bullets, and rocket blasts
- Wi-Fi test bridge for remote controls, physics telemetry, and live JPEG frames

## Host setup (Windows 11)

The official VitaSDK route is WSL2.

From an elevated PowerShell:

```powershell
wsl --install -d Ubuntu
```

After rebooting, open Ubuntu and run:

```bash
sudo apt update
sudo apt install -y make git-core cmake python3
export VITASDK=/usr/local/vitasdk
export PATH=$VITASDK/bin:$PATH
echo 'export VITASDK=/usr/local/vitasdk' >> ~/.bashrc
echo 'export PATH=$VITASDK/bin:$PATH' >> ~/.bashrc
git clone https://github.com/vitasdk/vdpm ~/vdpm
cd ~/vdpm
./bootstrap-vitasdk.sh
./install-all.sh
```

The Vita already has `ShaRKF00D`, which is a strong sign that `libshacccg.suprx` was prepared. vitaGL requires that runtime shader compiler file.

## Build

From Ubuntu/WSL, adjust `/mnt/c/...` if the Windows user/workspace path differs:

```bash
cd /mnt/c/Users/rafel/PromSRC/workspace/games/figure-8-drift-vita
rm -rf build
mkdir build && cd build
cmake ..
make -j$(nproc)
```

Expected output:

```text
build/figure8_vita.vpk
```

## Native PC city preview

The Windows preview parses the authoritative building, road, highway, and ramp
arrays directly from `src/main.cpp`. It provides a fast fly-through for checking
layout and bridge clearance without installing a VPK.

```powershell
python -m pip install -r requirements-preview.txt
.\preview-city.ps1
```

Controls:

- W/A/S/D: move the preview camera
- Q/E: raise/lower
- Arrow keys: look around
- Left Shift: move faster
- Escape: close

Automated visual checks:

```powershell
python tools/city_preview.py --view overview --snapshot build-v04/city-preview.png
python tools/city_preview.py --view underpass --snapshot build-v04/city-underpass.png
python tools/city_preview.py --view roads --snapshot build-v04/city-roads.png
python tools/city_preview.py --view topdown --snapshot build-v04/city-topdown.png
```

## Install on the connected Vita

1. Copy `figure8_vita.vpk` to `D:\downloads\figure8_vita.vpk` while USB storage is mounted.
2. Safely disconnect USB mode.
3. In VitaShell, browse to `ux0:downloads/figure8_vita.vpk` and install it.
4. Launch the **Figure 8 Drift** bubble.

No `tai` plugins or system files need to be changed.

## Wi-Fi test bridge

The bridge targets the Vita at `10.0.0.231` by default. Start it on the PC:

```powershell
node pc-bridge/server.mjs
```

Then open `http://127.0.0.1:8791`. The game listens on UDP `18792` and replies to the bridge on UDP `18793`. It accepts remote buttons/sticks, returns live physics telemetry, and streams 320x180 JPEG frames while the bridge is connected. The visible **SELECT** button sends the native Select bit (`0x000001`); it cycles camera angles exactly like Vita Select. Local Vita controls continue to work.

Override the saved Vita address when needed:

```powershell
$env:VITA_IP='10.0.0.231'; node pc-bridge/server.mjs
```

Keep these ports on the local network; do not forward them through the router.

## Port status

The native game builds and has been tested on real Vita hardware. Current features include Figure 8 Drive, Build Track, and City Drive modes; arcade two-axle drift physics; rear-lock handbrake initiation; loose low-drag grass; brighter daylight rendering; menu and HUD; persistent skid marks that clear on reset; six protected custom-track save slots; and a multi-district city with mixed-width grids, five ground-level curved routes, alleys, traversable roundabouts, neighborhoods, parks, ponds, hills, raised curb/grass transitions, a looping layered elevated highway with textured ramps and usable underpasses, an industrial district beyond the bridge with loading yards and container slaloms, destructible buildings, and physics-driven street furniture.
