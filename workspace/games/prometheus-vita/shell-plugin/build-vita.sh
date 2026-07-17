#!/usr/bin/env bash
set -euo pipefail
export VITASDK=/usr/local/vitasdk
export PATH="$VITASDK/bin:/usr/bin:$PATH"
project=/c/Users/rafel/PromSRC/workspace/games/prometheus-vita/shell-plugin
rm -rf "$project/build"
/usr/bin/cmake -S "$project" -B "$project/build" -G "Unix Makefiles" -DCMAKE_TOOLCHAIN_FILE="$VITASDK/share/vita.toolchain.cmake" -DCMAKE_BUILD_TYPE=Release
/usr/bin/cmake --build "$project/build" -j4
cp "$project/build/prometheus_vita_control.suprx" "$project/../deploy/prometheus_vita_control.suprx"
