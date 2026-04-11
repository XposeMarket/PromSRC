# MEMORY.md - Long-Term Context

> Durable long-term context, historical decisions, and continuity notes.

---

## project_memory
- (empty)

- 2026-04-10: User explicitly confirmed desire to begin making concrete changes to the Xpose Market website now, after first verifying availability of the `run_task_now` tool. [2026-04-10]
- 2026-04-10: Xpose Market website repo path verified in workspace as `xposemarket-site/` with `.git/`, `index.html`, `services.html`, and `testimonies.html`; next step is to inspect real file/git state directly instead of relying on prior session claims. [2026-04-10]
- 2026-04-11: User deleted prior teams after redoing the team/subagent/coordinator system and wants a fresh architecture review focused on whether base preset roles plus specialization are sufficient for standing teams (website rebuild, lead gen, nightly bug hunting). [2026-04-11]
## key_decisions
- 2026-04-09: High-priority declared-plan state-machine bug isolated to `src/gateway/routes/chat.router.ts`; hidden skill-scout pre-step and visible step-1 progress can desync, producing false repeated "run skill_list first" loops. [verified via proposal `prop_1775759744962_a7c1d3` and audit notes 2026-04-09]
- (empty)

## long_term_context
- 2026-04-09: Declared-plan reliability work is now an active long-term through-line; a concrete patch proposal exists to separate hidden scout completion from visible step progression in `chat.router.ts` (`prop_1775759744962_a7c1d3`).
- (empty)

---

*Use this file for durable memory only. Keep short-lived notes in workspace/memory/*
