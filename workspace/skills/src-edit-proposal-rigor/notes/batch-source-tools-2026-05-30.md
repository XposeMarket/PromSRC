# Batch Source Tools, 2026-05-30

Prometheus source-edit agents should prefer batch tools for normal coding work:

- Use `read_dev_sources` for multi-file Prometheus source inspection across `src/` and `web-ui/`.
- Use `apply_dev_source_patchset` for grouped approved source edits after `request_dev_source_edit` or proposal approval.
- Use `read_files_batch` and `apply_patchset` for normal workspace files.
- Tiny read/write tools remain useful for one-off emergency edits, but repeated read/edit loops should be treated as a speed smell.

Patchset behavior to preserve:

- validate every edit before writing
- syntax-parse changed JS/TS/JSX/TSX files
- return slim output with touched files and telemetry
- expose touched files in `data` / `extra` so read caches and duplicate-skip state can be invalidated

Important telemetry fields:

- `readCount`
- `editCount`
- `failedAnchors`
- `linesChanged`
- `insertions`
- `deletions`
- `syntaxMs`
- `durationMs`

After a patchset, still run the narrow verification profile or command required by the changed surface.
