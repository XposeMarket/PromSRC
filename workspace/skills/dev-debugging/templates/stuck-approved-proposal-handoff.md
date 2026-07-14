# Stuck approved-proposal diagnostic handoff

Use this only when the user explicitly requests a ChatGPT Desktop handoff for an approved proposal whose governed executor is missing, stuck, or not visible.

## Verify before handoff

- proposal ID, title, approval state, and canonical store path;
- whether the expected source change is already present;
- the executor task/run ID and its last grounded state, when available;
- exact task-control or diagnostics output;
- whether generated artifacts are stale but outside the approved scope.

## Prompt template

```text
Please diagnose a stuck Prometheus source-proposal execution.

Proposal: <proposal_id> — <title>
Approval state: <state>
Canonical proposal path: <path>
Executor/task evidence: <result>
Current source evidence: <symbol, path, or behavior>

Determine whether the governed executor ran, failed, or lost its task linkage. Recommend the smallest recovery inside the existing source-proposal system and the tests needed afterward. Do not apply a direct patch or bypass the approved proposal lane.
```

After visible submission, follow the normal proof and bounded-monitoring rules. Treat ChatGPT's response as diagnostic input; verify proposal state, source diff, build, and tests independently before reporting recovery.
