---
name: "pptx-writer"
description: "Create or edit a local PowerPoint (.pptx) only when the user explicitly requests a PowerPoint file and a supported presentation backend passes the bundled preflight. Do not invoke for ordinary outlines, HTML slides, or generic presentation advice."
---

# PPTX Writer

Create an editable `.pptx` only after proving that the local presentation backend works. Never claim that a deck was generated from an outline, HTML preview, or unverified file.

## Preflight

Run from the Prometheus repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File workspace/skills/pptx-writer/scripts/test-backends.ps1
```

Proceed only when the script reports a usable generation backend and a usable render backend. A Node installation alone is not a presentation backend.

Current supported candidates are:

- `pptxgenjs` resolvable from the Prometheus repository for generation.
- LibreOffice (`soffice`) for rendering generated slides to PDF/images.
- Native PowerPoint automation on Windows as an alternative generation/render route.

Do not install packages, download binaries, or silently switch to screenshots. If preflight is blocked, state which backend is missing and offer slide-by-slide content without calling it a `.pptx` deliverable.

## Build and verify

1. Create work files in a disposable temporary directory, not at a hard-coded drive path.
2. Use a 16:9 layout unless the user specifies another ratio.
3. Keep one core message per slide and preserve editable text, charts, and shapes.
4. Export to the user-requested destination or an `outputs/` directory.
5. Confirm the final file exists and has nonzero bytes.
6. Render every slide through the backend proven by preflight.
7. Inspect the rendered slides for clipping, overflow, overlap, unreadable type, and broken assets. Correct problems and render again.
8. Report the exact `.pptx` path and any validation limitation.

For a disposable backend round trip, run:

```powershell
node workspace/skills/pptx-writer/scripts/verify-roundtrip.mjs --output-dir .tmp/pptx-writer-roundtrip
```

This fixture proves editable generation and LibreOffice rendering. It does not replace inspecting every slide of the user's actual deck.

## Fail-closed rules

- Do not assume a fixed drive path or use the nonexistent `workspace/doc-skills-setup.js` installer.
- Do not treat successful script execution as visual QA.
- Do not report success when rendering is unavailable.
- Do not leave temporary source scripts or rendered QA files in the deliverable directory.
