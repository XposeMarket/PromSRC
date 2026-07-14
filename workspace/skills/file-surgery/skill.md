---
name: "file-surgery"
description: "Make precise, evidence-backed edits to workspace files, source files, Markdown, JSON, YAML, and configuration while preserving unrelated user changes. Use for local file modification and patch recovery; use src-edit-proposal-rigor when Prometheus self-source approval or proposal policy is the primary task."
---

# File surgery

Treat every edit as a scoped transformation of the current file, not a rewrite from memory.

## Operating loop

1. **Locate.** Confirm the exact path and repository/workspace boundary.
2. **Inspect.** Read enough surrounding structure to understand the current state. Search first when the file is large.
3. **Check risk.** Preserve user edits, secrets, generated/source boundaries, and applicable repository instructions.
4. **Plan.** Identify the smallest coherent change and its validation method.
5. **Edit.** Prefer `apply_patch` for intentional text changes. Use formatters only for mechanical rewrites they own.
6. **Verify.** Re-read the changed region, parse structured formats, and run the smallest relevant test/build.
7. **Report.** State what changed, what was validated, and any remaining limitation.

Never discard or overwrite unrelated dirty-worktree changes. Do not use destructive Git recovery unless the user explicitly requests it.

## Format rules

- For JSON, parse after editing and preserve unknown fields.
- For YAML/frontmatter, quote ambiguous scalar values and reject duplicate keys.
- For Markdown, preserve link targets and heading structure.
- For source code, follow local patterns and test in proportion to risk.
- For secrets/configuration, avoid printing secret values and keep credentials in the intended vault or environment boundary.

## Patch recovery

An exact-text failure means the source changed or the patch context was wrong. Re-read the live file, search for the semantic anchor, and produce a new patch from current content. Never retry the identical failed replacement repeatedly. If generated output differs from source, edit the canonical source and regenerate through the repository’s supported command.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for tool-selection tables, multi-section edits, language-specific cautions, and the full recovery protocol.
- Read [codex-style-engineering-mode.md](references/codex-style-engineering-mode.md) for repository engineering discipline.
- Read [workspace-file-tools-not-shell.md](references/workspace-file-tools-not-shell.md) when deciding between native file tools and shell operations.
- Read `references/recovery/text-match-failures.md` only when an edit fails because expected text cannot be found.

The goal is a minimal correct patch with observable validation—not merely a successful write operation.
