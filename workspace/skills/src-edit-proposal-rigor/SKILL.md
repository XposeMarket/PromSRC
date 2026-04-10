---
name: SRC Edit Proposal Rigor
description: Create high-quality src code edit proposals with exact-file evidence and deterministic change plans. Use whenever preparing a write_proposal that touches src/ files, especially feature_addition or src_edit proposals. Enforces reading exact files/lines first, citing current flow, specifying exact edits, expected output/behavior after patch, acceptance tests, and risk/compatibility notes. Triggers on: src proposal, write_proposal, src_edit, feature proposal, code change proposal, proposal details, exact source edits, acceptance tests, proposal quality.
emoji: "🧭"
version: 1.1.0
---

# SRC Edit Proposal Rigor

A strict pre-proposal workflow for any change that edits `src/` code.

---

## Why this skill exists

`src/` proposals must be auditable and deterministic. Never draft from assumptions. Always prove current behavior from exact source reads, then specify exact intended edits and expected behavior after patch.

This skill sharpens and extends runtime proposal requirements by forcing evidence-first planning.

---

## Mandatory rules (hard constraints)

1. **Read before proposing**
   - Always inspect relevant code using `read_source`, `grep_source`, and `list_source` before writing `write_proposal`.
   - Never claim file paths, functions, or line ranges without reading them.

2. **Reference exact files + line ranges**
   - Proposal details must cite concrete files and approximate/actual line ranges that will change.
   - If line ranges shift during investigation, refresh with `read_source` again before finalizing.

3. **Describe current flow first**
   - For each affected behavior, describe the current execution flow from source evidence.
   - Name functions, conditions, and key variables involved.

4. **Specify exact edits, not vague intent**
   - For each file: state what will be inserted/replaced/deleted and where.
   - Include critical snippets or pseudo-diff blocks for reviewer clarity.

5. **State deterministic behavior after patch**
   - Explain exactly how runtime behavior changes in normal, edge, and failure paths.
   - Include invariants and anything intentionally unchanged.

6. **Define acceptance tests**
   - Include concrete validation steps (commands, routes, inputs, expected outputs/logs/UI states).
   - If build/restart required, say so explicitly.

7. **Cover risk and compatibility**
   - Note possible regressions, backward compatibility impact, and mitigation.

8. **Respect required section headings for src proposals**
   - In `write_proposal.details`, use these exact headings:
     - `Why this change`
     - `Exact source edits`
     - `Deterministic behavior after patch`
     - `Acceptance tests`
     - `Risks and compatibility`

9. **Pin the canonical src executor explicitly**
   - Every `write_proposal` that edits `src/` must set `executor_agent_id` to `code_executor_synthesizer_v1` in this workspace.
   - Never leave `executor_agent_id` blank and never use `main` or brainstorm/summarizer/research executors for src edits.
   - If `code_executor_synthesizer_v1` is unavailable, run `agent_list`/`agent_info`, resolve the canonical replacement, and state that decision explicitly in the proposal summary/details before submitting.
10. **Harden executor prompt for deterministic execution**
   - `executor_prompt` must be explicit that the executor is performing source edits, not analysis-only work.
   - Require: apply only listed file edits, run required build/tests, report exact changed files, and stop on mismatch/blocker.

11. **Preflight execution-routing checks**
   - Before submitting, validate:
     - `executor_agent_id` is exactly `code_executor_synthesizer_v1`
     - `code_executor_synthesizer_v1` exists in `agent_list` output
     - proposal `type` is `src_edit` or `feature_addition` when touching `src/`
   - If any preflight check fails, do not submit until fixed.


---

## Step-by-step workflow

### 1) Scope discovery
- Use `grep_source` to locate relevant symbols, routes, handlers, and call sites.
- Use `list_source` to verify module boundaries.
- Build an evidence list: `{file, function, line range, why impacted}`.

### 2) Evidence capture
- Read each impacted file with `read_source`.
- Summarize **current flow** in bullet points tied to source locations.
- Identify neighboring code that may be indirectly impacted.

### 3) Edit plan drafting
- Convert intent into a per-file patch plan:
  - file path
  - exact region to modify
  - concrete change description
  - expected local effect
- Add notes for any new files, imports, interfaces, or type updates.

### 4) Behavioral contract
- Write pre/post behavior matrix:
  - happy path
  - edge cases
  - error paths
  - no-change guarantees

### 5) Validation plan
- Define deterministic test steps (build, targeted run path, observable outputs).
- Include negative tests if relevant.

### 6) Proposal assembly
- Submit `write_proposal` with complete, evidence-backed details.
- Ensure `affected_files` matches the edit plan exactly.
- Ensure executor prompt instructs agent to apply only the specified edits.

---

## Proposal detail template (copy into write_proposal.details)

## Why this change
- Problem statement:
- Why current behavior is insufficient:
- Source evidence (file + lines):

## Exact source edits
- `src/...fileA.ts` (lines X-Y):
  - Current flow summary:
  - Planned edit:
- `src/...fileB.ts` (lines A-B):
  - Current flow summary:
  - Planned edit:
- Any new file(s): path + purpose

## Deterministic behavior after patch
- Happy path:
- Edge cases:
- Error handling:
- Explicit non-changes:

## Acceptance tests
1. Build/typecheck steps:
2. Runtime verification steps:
3. Expected outputs/logs/UI states:
4. Regression checks:

## Risks and compatibility
- Potential risks:
- Backward compatibility:
- Mitigations/rollback:

---

## Quality gate checklist (must pass before write_proposal)

- [ ] Every impacted `src/` file was read directly.
- [ ] Proposal cites concrete file paths and line ranges.
- [ ] Current flow is described from evidence, not memory.
- [ ] Exact edits are specified per file.
- [ ] Post-patch behavior is deterministic and testable.
- [ ] Acceptance tests are executable and observable.
- [ ] Risks + compatibility are explicitly addressed.
- [ ] Required section headings are exact and present.

If any box is unchecked, do not submit the proposal yet.