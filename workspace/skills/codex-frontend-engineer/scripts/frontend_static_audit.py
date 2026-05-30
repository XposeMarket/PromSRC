#!/usr/bin/env python3
"""
Static frontend audit for common generated-UI smells.

This is intentionally conservative. It finds review prompts, not proof of defects.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

TEXT_EXTENSIONS = {
    ".css",
    ".html",
    ".htm",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".vue",
    ".svelte",
}

SKIP_DIRS = {"node_modules", "dist", "build", ".git", ".next", "coverage"}

CHECKS: list[tuple[str, re.Pattern[str], str]] = [
    (
        "viewport-font",
        re.compile(r"font-size\s*:\s*[^;]*(?:vw|vmin|vmax)", re.I),
        "Font size scales directly with viewport units. Prefer token/clamp systems that do not make labels unpredictable.",
    ),
    (
        "negative-letter-spacing",
        re.compile(r"letter-spacing\s*:\s*-\s*[\d.]+", re.I),
        "Negative letter spacing is usually forbidden by the Codex-like frontend rules.",
    ),
    (
        "large-radius",
        re.compile(r"border-radius\s*:\s*(?:[2-9]\d|1[2-9])px", re.I),
        "Large radii can signal generic card-heavy UI. Confirm it matches the design system.",
    ),
    (
        "gradient-purple",
        re.compile(r"(linear-gradient|radial-gradient)[^;]*(#7c3aed|#8b5cf6|#a855f7|purple|violet)", re.I | re.S),
        "Purple gradients are overused in generated UI. Confirm the palette is intentional and domain-specific.",
    ),
    (
        "fixed-hero-copy",
        re.compile(r"unlock your|transform your|revolutionize|future of|all-in-one platform", re.I),
        "Generic landing-page copy found. Confirm this is a requested marketing page.",
    ),
    (
        "div-button",
        re.compile(r"<div[^>]+onClick=|<div[^>]+onclick=", re.I),
        "Clickable div found. Prefer button or anchor semantics unless there is a strong reason.",
    ),
    (
        "missing-alt",
        re.compile(r"<img(?![^>]*\salt=)[^>]*>", re.I),
        "Image without alt text found.",
    ),
]

HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")

THEME_FAMILIES = {
    "purple": re.compile(r"^#(?:6d28d9|7c3aed|8b5cf6|9333ea|a855f7|c084fc)", re.I),
    "slate": re.compile(r"^#(?:0f172a|111827|1e293b|334155|475569)", re.I),
    "sand": re.compile(r"^#(?:f5f5dc|faf7f2|f5efe6|e8dcc8|d6c2a8)", re.I),
    "orange-brown": re.compile(r"^#(?:7c2d12|9a3412|c2410c|ea580c|78350f)", re.I),
}


def iter_files(root: Path):
    if root.is_file():
        if root.suffix.lower() in TEXT_EXTENSIONS:
            yield root
        return

    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in TEXT_EXTENSIONS:
            yield path


def line_number(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def audit_file(path: Path, root: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        return [f"{path}: could not read file: {exc}"]

    rel = path.relative_to(root) if path.is_relative_to(root) else path
    findings: list[str] = []

    for code, pattern, message in CHECKS:
        for match in pattern.finditer(text):
            findings.append(f"{rel}:{line_number(text, match.start())}: [{code}] {message}")

    hexes = HEX_RE.findall(text)
    if len(hexes) >= 8:
        family_hits = {name: 0 for name in THEME_FAMILIES}
        for value in hexes:
            for name, pattern in THEME_FAMILIES.items():
                if pattern.match(value):
                    family_hits[name] += 1
        dominant = [name for name, count in family_hits.items() if count >= max(4, len(hexes) // 3)]
        for name in dominant:
            findings.append(
                f"{rel}:1: [one-note-palette] Many colors fall into {name}. Confirm the palette has enough contrast and domain specificity."
            )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan frontend files for review-worthy UI anti-patterns.")
    parser.add_argument("path", nargs="?", default=".", help="File or directory to scan")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.exists():
        print(f"Path does not exist: {root}")
        return 2

    findings: list[str] = []
    for file_path in iter_files(root):
        findings.extend(audit_file(file_path, root if root.is_dir() else root.parent))

    if not findings:
        print("No static frontend audit warnings found.")
        return 0

    print("Static frontend audit warnings:")
    for item in findings:
        print(f"- {item}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
