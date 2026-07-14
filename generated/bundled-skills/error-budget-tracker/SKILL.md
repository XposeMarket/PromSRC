---
name: "error-budget-tracker"
description: "Log and analyze tool or workflow failures, unresolved errors, repeated timeouts, rate limits, reliability patterns, and error-budget reports. Use when the user asks what keeps failing or wants structured operational failure evidence."
---

# Error Budget Tracker

Track failures as evidence, not as a substitute for diagnosis.

## Workflow

1. Use the configured Prometheus workspace/audit location; never assume a machine-specific drive path.
2. Append one sanitized JSONL record per failure with timestamp, agent/workflow, tool, typed failure, short message, retry count, resolution state, and a correlation or run ID.
3. Redact secrets, authorization headers, sensitive query values, personal data, and excessive payload excerpts before persistence.
4. Keep tool failure, validation failure, and successful recovery as separate signals. A retry count or tool count does not imply confidence.
5. Summarize a bounded time window by type, tool, workflow, unresolved count, retry severity, and recurrence across distinct runs.
6. Flag patterns only from explicit thresholds and show the underlying counts.
7. Link high-risk or recurring failures to the structured diagnostic packet and self-repair triage flow; do not patch source from this skill.
8. Report what is observed, what is inferred, freshness, and next diagnostic action.

Read [the detailed guide](references/detailed-guide.md) for JSONL shapes, summarization code, retry wrappers, and report examples. Adapt its legacy paths to the current configured workspace before use.

## Never

- Log raw secrets or full request/response bodies.
- mark a failure resolved merely because a later tool call succeeded.
- silently rewrite history; append correction/resolution events.
- turn assistant wording or tool volume into user-approval evidence.
