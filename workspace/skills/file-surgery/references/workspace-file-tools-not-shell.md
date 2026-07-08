# Workspace files — native tools, not shell

Migrated from workspace SOUL.md (2026-07-07 soul slim-down).

## Rule

Read and edit workspace files (including subagent `schedule-memory.md`) with workspace/file tools (`workspace_read`, `workspace_edit`, `read_file`, `present_file` when available). Do not use `run_command`, PowerShell, Python, or sed as the default editor.

## memory_read scope

`memory_read` only loads full **USER.md**, **SOUL.md**, or **MEMORY.md** — not arbitrary paths.

## Grep / search no-match

When `workspace_read` grep/search returns zero matches, suspect the pattern (regex escaping, wrong path, literal vs regex) before concluding content is missing. Re-read a focused line range or narrow the path.

## Prometheus src/

For `src/` and `web-ui/` self-edits: exact paths and line evidence; prefer `request_dev_source_edit` when Raul asks for direct fixes — see **src-edit-proposal-rigor**.