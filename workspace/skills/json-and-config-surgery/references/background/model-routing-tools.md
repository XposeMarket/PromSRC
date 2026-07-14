# Model routing tools note — 2026-05-09

Evidence: `Brain/skill-episodes/2026-05-09/episodes.jsonl` entries 1-2; `Brain/skill-gardener/2026-05-09/workflow-episodes.jsonl` entries 1-5; `audit/chats/transcripts/telegram_1799053599_1778334493712.md:4-220`.

When the problem is model/provider routing, proposal executor defaults, background agent defaults, or a specific subagent stuck on the wrong provider, do **not** start by raw-editing `.prometheus/config.json`.

Preferred order:

1. Use `get_agent_models` to inspect live global/default/per-agent routing.
2. Use `set_agent_model` for allowed runtime model changes, including defaults such as `proposal_executor_low_risk`, `background_agent`, and specific configured subagents such as `analyst_xbookmark_v1`.
3. Re-read with `get_agent_models` to verify persistence/live state.
4. Use raw JSON config surgery only when first-class model tools are unavailable or insufficient.
5. If config write scope is blocked and no first-class tool exists, use the `dev-debugging` Codex handoff path rather than unsafe shell edits.

This keeps runtime model repair owner-authorized, narrow, validated, and avoids unnecessary direct config mutation.
