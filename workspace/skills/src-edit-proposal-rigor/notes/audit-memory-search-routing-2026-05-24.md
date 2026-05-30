# Audit/memory search routing guardrail — 2026-05-24

When a Prometheus source/debugging investigation needs to inspect runtime evidence under `audit/**`, `memory/**`, `Brain/**`, uploads, or other workspace-root artifacts, do not use prom-root/source-scoped search tools against those paths. Prom-root/source tools are allowlisted for source surfaces such as `src/`, `web-ui/`, scripts, package files, and self docs; they will reject `audit`/`memory`/`workspace` paths.

Correct pattern:

1. Use source tools for Prometheus source files (`src/**`, `web-ui/**`, package/self docs).
2. Use workspace file tools (`search_files`, `grep_file`, `read_file`, `file_stats`, `list_directory`) for audit transcripts, notes, Brain artifacts, uploads, and other workspace evidence.
3. Pass paths relative to the workspace root directly, for example `audit`, `memory`, `Brain/skill-gardener/2026-05-24/workflow-episodes.jsonl`; do not pass a synthetic `workspace` directory unless it actually exists.
4. If a search fails because the path is outside an allowlist, switch tool families immediately instead of retrying the same query with another invalid root.

## Evidence

During `audit/chats/transcripts/3454a6af-6c01-4083-a1f6-6a728234ada4.md:141-150`, a mobile voice latency investigation needed source plus audit/memory evidence. The workflow episode recorded repeated routing errors: `grep_prom` against `audit` and `workspace` failed as outside the prom-root allowlist, and `search_files` against `workspace` failed because that directory did not exist (`Brain/skill-gardener/2026-05-24/workflow-episodes.jsonl:2`).