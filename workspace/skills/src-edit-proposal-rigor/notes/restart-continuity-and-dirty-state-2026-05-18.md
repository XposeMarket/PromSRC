# Restart Continuity + Dirty State Guardrail (2026-05-18)

When a `src/` / Creative / package migration conversation resumes after a gateway restart, do not summarize from the last compacted narrative alone. First re-ground in actual execution evidence before saying whether work was only analysis, proposal drafting, command execution, or source editing.

Minimum check before reporting current state:

1. Review the current transcript around the interruption for approval blocks, command approvals, dev source edit approvals, and user corrections.
2. Inspect relevant git/package state when available (`git status`, targeted diffs, package/package-lock state) before claiming no edits occurred.
3. Separate scoped migration diffs from unrelated dirty work; explicitly say when the repo is broadly dirty and current changes may include unrelated files.
4. If build/typecheck verification was pending or interrupted, state the exact unfinished verification instead of implying success.

Evidence: `audit/chats/transcripts/d21a5103-4f64-4014-8a5b-7ee3406d9e50.md:1323-1350` shows the assistant initially summarized the HyperFrames Studio migration as source investigation/proposal-only after a restart; `:1351-1566` shows Raul corrected this with approved npm view/npm pack/install/build and dev source edit evidence; `:1568-1622` records the corrected state: packages upgraded to HyperFrames 0.6.20, Studio/static serving and producer export edits present, repo broadly dirty, and verification incomplete.