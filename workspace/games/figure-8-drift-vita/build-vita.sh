#!/usr/bin/env bash
set -euo pipefail
export VITASDK=/usr/local/vitasdk
export PATH="$VITASDK/bin:/usr/bin:$PATH"
project=/c/Users/rafel/PromSRC/workspace/games/figure-8-drift-vita
rm -rf "$project/build-v04"
/usr/bin/cmake -S "$project" -B "$project/build-v04" -G "Unix Makefiles" -DCMAKE_TOOLCHAIN_FILE="$VITASDK/share/vita.toolchain.cmake" -DCMAKE_BUILD_TYPE=Release
/usr/bin/cmake --build "$project/build-v04" -j4
