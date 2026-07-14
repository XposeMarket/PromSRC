# Figure 8 Drift — PS Vita Port

Native PS Vita port of the browser game in `../figure-8-drift/`.

This is not a webpage wrapper. The Vita's browser cannot run the game's modern Three.js/WebGL module stack reliably, so the first Vita build recreates the core game in C++ with VitaSDK + vitaGL:

- native 960×544 hardware-accelerated 3D
- analog-stick steering
- Right trigger (R) to accelerate
- Left trigger (L) to brake/reverse
- Circle to commit/hold the current drift direction with minimal speed loss
- Triangle to reset
- Start to return to the main menu
- figure-8 track, chase camera, road/off-road grip, drift score/combo physics

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

## Install on the connected Vita

1. Copy `figure8_vita.vpk` to `D:\downloads\figure8_vita.vpk` while USB storage is mounted.
2. Safely disconnect USB mode.
3. In VitaShell, browse to `ux0:downloads/figure8_vita.vpk` and install it.
4. Launch the **Figure 8 Drift** bubble.

No `tai` plugins or system files need to be changed.

## Port status

The source scaffold and core native driving loop exist. It still needs a real VitaSDK compile and on-device test. After proof-of-life, the next pass should add HUD text, cones, checkpoints/laps, particles/skid marks, sound, better lighting, and track-builder/save support.
