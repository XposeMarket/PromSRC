# SPEC: delete unreachable code, one-off scripts and unused dependencies

Surface: single:desktop
Parity: single-surface: the three deleted web-ui modules are imported by nothing on either surface (web-ui/src/features/chat/multi-chat-intent.js:23 loads multi-chat-workspace-v2.js; SettingsPage.js:4274 owns the migration panel)
Test: node scripts/test-prune-dist.mjs
Size justification: deletion-only sweep. 18 files removed (about 2,070 lines, 769 KB), no new code. The size is the point of the change.

## Problem
A reachability pass over origin/main cc9e835b4 (import graph from every package.json script, CI workflow, electron-builder config and HTML entry) found files that no entrypoint, test, doc or config names:
- `web-ui/src/features/chat/multi-chat-workspace.js` (547 lines): superseded by `multi-chat-workspace-v2.js`, which is the only one loaded.
- `web-ui/src/onboarding/migration-panel.js` (257 lines) and `web-ui/src/components/creative/editor/interactions/snap.js` (132 lines): zero importers.
- `src/connections/discovery-service.ts` (113), `src/gateway/llm-primary.ts` (22), `src/security/index.ts` (13): zero importers. `llm-primary.ts` dates from the April import.
- Ten one-off skill-catalog migration scripts from 2026-07-14 that were run once and are referenced by nothing.
- `three.min.js` (670 KB) at the repo root: nothing loads it; `three` is an npm dependency.
- `ARCHITECTURE_ANALYSIS.md`: a May design note for product previews that have since shipped; nothing links to it.
- Dependencies with no import anywhere in the repo: `chalk`, `dotenv`, `fluent-ffmpeg`, `@lottiefiles/dotlottie-web`, `@types/fluent-ffmpeg`.
- `postbuild` re-runs `copy-extension-descriptors.js`, which `build:backend` already ran; `prepare:public:desktop` does the same.
- `tsconfig.json` excludes `src/**/*-legacy.ts`, which matches no file.

## Existing code
Nothing replaces these because nothing uses them. `scripts/prune-dist.js` already removes compiled output for deleted sources, so `dist/` does not keep stale copies.

## Options
1. Delete only files with zero importers and zero name mentions (this PR).
2. Also delete modules that only their own regression test imports (execution-controller, recommendation-service). Larger; they have docs, so that needs Raul's call.
3. Also untrack personal workspace data from the repo. Changes what a pull does to the live checkout, so it is a separate decision.

## Chosen approach
Option 1. Every deletion is provable from the repo alone and cannot change runtime behavior.

## Acceptance
- `npx tsc --noEmit` is clean; `npm run build` passes; `check:web-ui` and `check:stateful-imports` pass.
- The generated web UI no longer contains the three deleted modules.
- No remaining file in the repo references a deleted path or package.
- Must not: change any runtime behavior, tool surface, stored data or test.

## Out of scope
Test-only modules, tracked workspace data, the 401 unwired regression files, CI workflow edits, worktree cleanup.

## Files
- `web-ui/src/features/chat/multi-chat-workspace.js` - deleted, superseded by v2
- `web-ui/src/onboarding/migration-panel.js` - deleted, no importer
- `web-ui/src/components/creative/editor/interactions/snap.js` - deleted, no importer
- `src/connections/discovery-service.ts` - deleted, no importer
- `src/gateway/llm-primary.ts` - deleted, no importer
- `src/security/index.ts` - deleted, no importer
- `scripts/*.mjs` - ten one-off skill migration scripts deleted
- `scripts/stateful-dynamic-imports.baseline.json` - drop the entry for the deleted llm-primary.ts
- `three.min.js` - deleted, unreferenced
- `ARCHITECTURE_ANALYSIS.md` - deleted, unreferenced
- `package-lock.json` - lockfile for the removed dependencies
- `runtime-dependencies.public.json` - drop dotenv and fluent-ffmpeg from the packaged-app manifest
- `tsconfig.json` - drop the exclude pattern that matches nothing
- `scripts/prune-dist.js` - treat dist/config/build-identity.json as owned; `npm run check:dist` failed on every build because the build writes that file and it has no src twin
- `scripts/test-prune-dist.mjs` - the regression test: the build identity file must survive a prune and must not be reported by --check

## Scope notes
package.json: remove five unused dependencies, the duplicate `postbuild` script and the duplicate copy step in `prepare:public:desktop`.

## Risks
A file loaded by a path string the scan missed would fail at load time. Mitigation: repo-wide name search for every deleted basename returned no hits outside the delete set. Rollback is a plain revert of this commit.
