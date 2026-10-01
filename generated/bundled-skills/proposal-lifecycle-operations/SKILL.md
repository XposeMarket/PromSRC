---
name: "proposal-lifecycle-operations"
description: "Manage Prometheus proposals through drafting, review, approval boundaries, and verification. Use for a proposal lifecycle; not for directly editing ordinary workspace files (file-surgery)."
---

# Proposal Lifecycle Operations

Use this for `write_proposal`, `edit_proposal`, pending proposal review, and durable request/approval handoff. Do not confuse a proposal with approval itself, a final UI action approval, or a completed execution.

## Classify before writing

Decide whether the proposal is `general` internal/read/research/orchestration or `action` user-world work. For action proposals, confirm the current gap still exists, identify affected files or external state, and include concrete execution steps and acceptance checks. For source edits, include why, exact edits, deterministic behavior, tests, risks, and compatibility.

## Make proposals executable

Include a precise title, current-state summary, objective, affected paths or external targets, diff/behavior preview, impact, build requirement, risk tier, executor, and a 3–7 step checklist. Avoid conceptual pseudocode, vague “investigate” steps, or hidden assumptions. Keep secrets out of proposal text.

## Revision and approval boundaries

Read or locate the durable request before editing a pending proposal. Edit only the intended fields and preserve the revision note. Approval of a proposal authorizes the defined work, not unrelated changes. Final-action approval for a send, publish, purchase, transfer, deletion, or submit is a separate one-shot gate. Never self-approve, infer approval from a user’s earlier unrelated message, or execute a stale/superseded proposal.

## Handoff and verification

After approval, pass the exact executor prompt and checklist to the assigned lane. Verify the real output: changed files/diff plus tests for code, artifact path and QA for generated files, or external readback and delivery evidence for connected actions. Report approved, executing, blocked, rejected, superseded, and verified-complete as separate states.

## Recovery

If a proposal is stale, partially executed, or interrupted, inspect request status, audit evidence, current diff, approvals, and external side effects before editing or resubmitting. Preserve the proposal history. Use a new revision or follow-up request rather than duplicating completed work.
