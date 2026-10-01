---
name: "creative-project-export-qa"
description: "Verify and recover a Creative project after authoring. Use for native creative timeline QA, blank video render recovery, or project export verification; use the named creation workflow to author footage, scenes, or graphics instead."
---

# Creative Project Export QA

Use for "native creative timeline qa", "blank video render recovery", or "project export verification". This checks exports and recovers failures; it does not author the video itself.

Use this as the cross-lane operational gate for substantial Creative work. Use hyperframes or a named creative workflow for authoring details; this playbook owns project state, handoffs, export verification, and recovery.

## Set up and inspect

Open or create the correct Creative project and mode before heavy work. Inspect current project state, references, assets, canvas/scene/timeline, source media, and prior history. Preserve user assets and keep edits reversible. Choose image/canvas, native video timeline, HyperFrames, or hybrid based on the deliverable.

## Build in stages

Project -> storyboard/brief -> assets with provenance -> scene/shot/timeline edits -> captions/audio/overlays -> lint/preflight -> render/export -> QA -> delivery. Keep source and generated/derived artifacts distinct. Use actual workspace paths and register project-bound assets when required.

## QA gate

Never claim a queued render or existing file is complete. Verify the actual export: decode, duration, dimensions, representative frames/contact sheet, text fit/overflow, contrast, crop, captions/timing, keyframes, audio sync, and required visible assets. For HyperFrames, lint/validate/inspect before render and sample the final MP4, not only the HTML preview.

## Recovery

For stale project or scene state, reread state and history. For missing assets, inspect provenance and re-import or use the nearest supported source. For queued renders, inspect status and logs, do not duplicate the render, and retry only the smallest failed stage. For blank frames, preserve source, inspect dimensions, paths, and runtime, fix one cause, then rerender. Verify the final path and decode; report not verified when evidence is incomplete.
