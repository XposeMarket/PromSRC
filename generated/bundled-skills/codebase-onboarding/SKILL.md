---
name: codebase-onboarding
description: Get up to speed on an unfamiliar repository by measuring it, mapping structure and entry points outline-first, tracing the main flows, and writing a reusable orientation file. Use for "learn this codebase", "get up to speed", "how big is this repo", or before a first change in a new project. Not for answering one specific code question (fast-coding-loop), debugging, or reviewing a diff.
---

# Codebase Onboarding

Goal: a durable mental map of a repository, written down so the next session (or a spawned worker) starts from it instead of re-reading everything. Map first, fetch details on demand.

## 1. Scope and reuse

- Check for an existing orientation file (`plans/<repo>-orientation.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`) and `memory(action:"search", query:"<repo> architecture")`. Update rather than redo.
- Ask, via one `ask_prometheus_questions` card only if unclear, what the onboarding is for: `Recommended: general map` / `Prepare for a specific change in <area>` / `Size and composition only`. A specific goal narrows every step below.

## 2. Measure (cheap, one command)

Use `workspace_run` with PowerShell, excluding dependency and build folders (`.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `venv`, `__pycache__`, `vendor`):

- File counts and line counts per extension, largest files, and top-level folder sizes. If `cloc`, `tokei`, or `pygount` is installed, prefer it with the same exclusions; do not install tools without asking.
- Note generated, vendored, binary, and duplicated files so they are excluded from reading.
- Pitfalls: Markdown counts as docs not code; JSON line counts are misleading; always exclude dependency trees or the scan hangs.

## 3. Map structure outline-first

- `workspace_read(action:"tree")` at depth 2 to 3, then manifests: `package.json` scripts, `tsconfig`, `pyproject`, `Cargo.toml`, CI workflows, Dockerfiles, env examples.
- Find entry points (main, server bootstrap, CLI, routes, workers) with one multi-pattern `workspace_read(action:"grep", regex:true)`.
- For large source files, use `workspace_code_nav(action:"outline")` before reading bodies; read only the symbols that matter (`workspace_code_nav(action:"definition")`, or `workspace_read` with `around_line`). The question before every full read: do I need all of this or just the map?
- `workspace_git(action:"log")` over a good stretch to find hot spots: files and areas that keep changing.

## 4. Trace the main flows

Pick 2 to 4 core flows (a request, a job, the main user action) and trace each end to end: trigger, routing, business logic, persistence, external calls, response. Record file:line anchors. Note tests that cover each flow and how to run them.

For a big repo, run the passes in parallel: spawn 2 to 3 explorers with `background_ops(action:"spawn", provider:"openai_codex", model:"gpt-6-luna")` (`gpt-6-sol` for deep flows), each with a disjoint scope (structure and entry points; data flow and state; tests, build, and conventions) and a reporting contract: sources read, file:line anchors, confidence, gaps, at most 20 bullets. Never spawn Anthropic workers from an Anthropic main chat. Read the cited lines yourself before accepting a claim.

"Read every file in full" is allowed only when the user explicitly asks for it and the repo is small; even then, outline first and skip generated and vendored code.

## 5. Write the orientation file

Save `plans/<repo-slug>-orientation.md` in the workspace (or `docs/` in the repo if the user wants it committed):

- Purpose, stack, size table, how to install, run, test, and build.
- Directory map with one line per area.
- Entry points and core flows with file:line anchors.
- Domain vocabulary (terms the code uses and what they mean).
- Conventions, hot spots, risky or fragile areas, and open questions.

Record a `write_note` with the path, and a `memory(action:"write")` fact only if the repo is one the user will keep working in.

## Guardrails

- Read-only: no edits to the repo during onboarding.
- Do not report agent summaries as facts without checking the cited lines.
- Keep the file a map, not a copy of the code.

## Exit criteria

Orientation file written and path reported; it answers how to run tests, where the entry points are, and how the main flows move, each with anchors.

Lineage: Inspired by NousResearch hermes codebase-inspection (MIT), thedotmack learn-codebase and smart-explore, rewritten for Prometheus.
