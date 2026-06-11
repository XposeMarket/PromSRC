#!/usr/bin/env bash
# Build prometheus-desktop-helper with swiftc directly.
#
# We bypass `swift build` (SwiftPM) because some Command Line Tools installs ship
# a broken manifest compiler (PackageDescription link failure). Direct swiftc
# against the SDK works fine. Package.swift is kept for editor/Xcode tooling.
set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR=".build"
OUT="$OUT_DIR/prometheus-desktop-helper"
mkdir -p "$OUT_DIR"

swiftc Sources/prometheus-desktop-helper/*.swift \
  -o "$OUT" \
  -O \
  -framework AppKit \
  -framework CoreGraphics \
  -framework ApplicationServices

echo "Built: $OUT"
