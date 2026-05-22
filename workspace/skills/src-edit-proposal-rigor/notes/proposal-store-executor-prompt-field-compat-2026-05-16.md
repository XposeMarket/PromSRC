# Proposal store source-read evidence compatibility note (2026-05-16)

## Evidence
During `audit/chats/transcripts/telegram_1799053599_1778944842333.md:73-99`, Prometheus attempted to submit a source-edit proposal after source reads for the scheduled-run `write_note` tool-schema issue. `write_proposal` rejected three attempts with `Missing: source-read evidence` even though the plan included source paths/evidence and an executor prompt. Skill episode evidence: `Brain/skill-episodes/2026-05-16/episodes.jsonl:2`.

Source inspection during Brain Dream found the likely compatibility seam:
- `src/gateway/proposals/proposal-store.ts:249-273` validates readiness against `partial.details` plus camelCase `partial.executorPrompt`.
- The public tool schema and current prompt guidance use snake_case `executor_prompt` (`src/gateway/tools/defs/cis-system.ts:773-779`).
- `createProposal()` validates before store normalization, so any caller that passes raw snake_case can lose executor-prompt evidence during validation.

## Guardrail until patched
When preparing a `src_edit` proposal, put explicit source-read evidence in the `details` body itself, not only in `executor_prompt`/`executorPrompt`.

Use a literal line such as:

```text
Source-read evidence: I inspected `src/...` with `read_source(...)` at lines X-Y and `grep_source(...)` for SYMBOL.
```

Keep using the current tool field `executor_prompt` as required by the active schema, but do not rely on it as the only place where `read_source`/`grep_source` evidence appears.

## Follow-up
Brain Dream 2026-05-16 filed a source proposal to normalize both `executorPrompt` and `executor_prompt` inside proposal-store validation. After that patch is approved and verified, this note remains useful as a conservative proposal-writing habit but should no longer be required for validator correctness.