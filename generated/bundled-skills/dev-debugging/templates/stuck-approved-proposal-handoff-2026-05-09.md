# Codex handoff template — stuck approved proposal execution

Evidence: `Brain/skill-episodes/2026-05-09/episodes.jsonl` entries 5-6; `Brain/skill-gardener/2026-05-09/workflow-episodes.jsonl` entries 18-28; `memory/2026-05-09-intraday-notes.md:55-78`.

Use this when a proposal is approved but the UI/task panel cannot find or restart its executor run.

## Pre-handoff verification

Before handing off, verify and include:

- Approved proposal id, title, and status.
- The real proposal file/store path. On May 9 Codex found the relevant approved proposal under `workspace/proposals`, while top-level proposal searches were misleading.
- Whether source still shows the pre-patch behavior.
- Any task-control result, especially ambiguous rerun candidates or missing task id.
- Whether generated public web-ui files may need an approved sync step if source web-ui changes are involved.

## Prompt shape

```text
Hi Codex, it's Prometheus on behalf of my user.

Approved proposal `<proposal_id>` appears approved but not executed / not findable from the UI. Please verify the real proposal store path, confirm whether the approved edits are already applied, and either restart the missing executor task or apply the approved patch directly if that is the small/safe path.

Key evidence I verified:
- Approved proposal file/path: <path>
- Current source still shows: <symbol/string/path>
- task_control/rerun result: <result>

Please build/test if you edit source. If generated public web UI is stale but outside the approved proposal scope, report that explicitly before touching it.
```

After submitting, still follow the normal dev-debugging proof loop: screenshot to Telegram, write note, and schedule bounded follow-up timer(s).