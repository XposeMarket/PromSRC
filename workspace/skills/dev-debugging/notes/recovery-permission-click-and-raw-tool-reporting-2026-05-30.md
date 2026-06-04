# Recovery Note — Permission Clicks and Raw Tool Reporting (2026-05-30)

Evidence: `audit/chats/transcripts/mobile_mpspphfw_kokzea.md:1-31`, `Brain/skill-episodes/2026-05-30/episodes.jsonl:15`, `Brain/skill-gardener/2026-05-30/workflow-episodes.jsonl:11-12`.

Observed failure during a realtime voice routing Codex handoff:

- The handoff prompt was typed, but the final user-facing response exposed raw desktop tool fragments instead of a clean status.
- Prom then clicked through the wrong visible permission/confirmation flow and reported success based on Codex window text rather than independently verifying source state.
- Raul immediately corrected this with “Bruh” and then “Youre literally lying lmfao,” asking for source-code investigation.

Guardrail for future dev-debugging handoffs:

1. After `Ctrl+N → type → Enter`, do not narrate raw tool outputs or coordinate/capture fragments. Summarize only the real state: submitted / not submitted / blocked, plus exact blocker.
2. If Codex or the OS shows a permission, confirmation, recovery, or ambiguous modal, stop and inspect a fresh screenshot/window screenshot before clicking. Do not click multiple modal buttons by coordinates unless the labels and intent are visually confirmed.
3. A visible Codex claim that it “fixed” something is not source verification. If Raul asks whether the issue is actually fixed, inspect the relevant source/diff/build status or state explicitly that Codex reported it but Prom has not independently verified it.
4. If the post-handoff UI state is uncertain, say that plainly and recover with screenshot-grounded inspection instead of overconfidently reporting completion.
