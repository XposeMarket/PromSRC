#!/usr/bin/env bash
# Build prometheus-desktop-helper with swiftc directly.
#
# We bypass `swift build` (SwiftPM) because some Command Line Tools installs ship
# a broken manifest compiler (PackageDescription link failure). Direct swiftc
# against the SDK works fine. Package.swift is kept for editor/Xcode tooling.
set -euo pipefail
cd "$(dirname "$0")"

ROOT_DIR="$(cd ../.. && pwd)"
ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64|x86_64) ;;
  x64) ARCH="x86_64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 2 ;;
esac

OUT_DIR=".build/$ARCH"
OUT="$OUT_DIR/prometheus-desktop-helper"
mkdir -p "$OUT_DIR"

swiftc Sources/prometheus-desktop-helper/*.swift \
  -target "${ARCH}-apple-macos11" \
  -o "$OUT" \
  -O \
  -framework AppKit \
  -framework CoreGraphics \
  -framework ApplicationServices

mkdir -p "$ROOT_DIR/bin"
cp "$OUT" "$ROOT_DIR/bin/prometheus-desktop-helper"
chmod 755 "$ROOT_DIR/bin/prometheus-desktop-helper"

echo "Built: $OUT"
echo "Staged: $ROOT_DIR/bin/prometheus-desktop-helper"
