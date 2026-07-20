#!/usr/bin/env bash
set -euo pipefail
export VITASDK=/usr/local/vitasdk
export PATH="$VITASDK/bin:/usr/bin:$PATH"
project=/c/Users/rafel/PromSRC/workspace/games/vitalink-vita
rm -rf "$project/build"
/usr/bin/cmake -S "$project" -B "$project/build" -G "Unix Makefiles" -DCMAKE_TOOLCHAIN_FILE="$VITASDK/share/vita.toolchain.cmake" -DCMAKE_BUILD_TYPE=Release
/usr/bin/cmake --build "$project/build" -j4
mkdir -p "$project/deploy"
cp "$project/build/vitalink_probe.vpk" "$project/deploy/vitalink_probe.vpk"
(
  cd "$project/deploy"
  files=()
  [[ -f vitalink_probe.vpk ]] && files+=(vitalink_probe.vpk)
  [[ -f vitalink_bt_probe_kernel.skprx ]] && files+=(vitalink_bt_probe_kernel.skprx)
  sha256sum "${files[@]}" > SHA256SUMS.txt.tmp
  mv SHA256SUMS.txt.tmp SHA256SUMS.txt
)
