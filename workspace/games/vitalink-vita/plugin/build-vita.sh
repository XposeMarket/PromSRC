#!/usr/bin/env bash
set -euo pipefail
export VITASDK=/usr/local/vitasdk
export PATH="$VITASDK/bin:/usr/bin:$PATH"
project=/c/Users/rafel/PromSRC/workspace/games/vitalink-vita
rm -rf "$project/plugin/build"
/usr/bin/cmake -S "$project/plugin" -B "$project/plugin/build" -G "Unix Makefiles" -DCMAKE_TOOLCHAIN_FILE="$VITASDK/share/vita.toolchain.cmake" -DCMAKE_BUILD_TYPE=Release
/usr/bin/cmake --build "$project/plugin/build" -j4
mkdir -p "$project/deploy"
cp "$project/plugin/build/vitalink_bt_probe_kernel.skprx" "$project/deploy/"
(
  cd "$project/deploy"
  files=()
  [[ -f vitalink_probe.vpk ]] && files+=(vitalink_probe.vpk)
  [[ -f vitalink_bt_probe_kernel.skprx ]] && files+=(vitalink_bt_probe_kernel.skprx)
  sha256sum "${files[@]}" > SHA256SUMS.txt.tmp
  mv SHA256SUMS.txt.tmp SHA256SUMS.txt
)
