---
name: implementation-plan-execution
description: Execute a saved implementation plan or ticket graph task by task with a durable progress ledger, test-first steps, expected-output checks, recorded rulings, optional parallel workers per independent task, and one final fresh review. Use when the user says execute, continue, or resume a plan file; not for writing the plan, ad hoc single edits, or work with no saved plan.
---

# Implementation Plan Execution

You are the executor. The plan file is the instruction set, the spec is the authority it argues from, and the ledger file is the record of what is done. Chat memory does not survive compaction; the ledger and `git log` do.

## 1. Setup

1. Read the plan once. Note its Global constraints, Allowed APIs, and Review focus. If it names a spec, read that too; conflicts inside the plan resolve against the spec. No reachable spec means rulings are provisional; note that in the ledger.
2. Isolation: never implement on main/master without the user's explicit consent. For Prometheus source, follow `promsrc-pr-worktree` (linked worktree under `C:\Users\rafel\promsrc-pr\<slug>`). For other repos, create a branch or `git worktree add` via `workspace_run`, after checking with `workspace_git(action:"status")` that you are not already isolated.
3. Ledger: `plans/<plan-slug>-progress.md` next to the plan (or the workspace `plans/` folder). First line: `# Ledger for plan: <plan path>`. If it exists and names this plan, every `Task N: complete` line is DONE; resume at the first task without one and trust the ledger plus `git log` over memory. A ledger naming a different plan is not yours.
4. `declare_plan` with one step per plan task (group if more than 6), and `complete_plan_step` as each lands.
5. Pre-flight: for every task that consumes what an earlier task produces, compare the Interfaces blocks. Record each mismatch and your ruling (spec wins) in the ledger, or write `Pre-flight: no shared interfaces`.
6. Baseline: run the project's test command once and record the result, so later failures are attributable.

## 2. Task loop

For each task, in order (or by frontier, see section 3):

1. Re-read the task text from the plan file; do not work from memory.
2. Work its steps in order under `test-first-development`: write the failing test, run it, watch it fail for the right reason. A test that passes before implementation is a finding about the test.
3. Every command has an `Expected:` line. Compare real output:
   - Matches: next step.
   - Code is wrong: debug with `root-cause-debugging`; never patch the symptom to match.
   - Plan is wrong (contradicts the spec, interface mismatch, impossible command): make the smallest change that satisfies the spec and append `Task N: Ruling: <finding> -> <decision and why>` to the ledger. Later tasks read rulings from the ledger.
4. Edits follow `fast-coding-loop`: batched reads, `workspace_edit(action:"patchset")`, no drive-by refactors.
5. Redirect long test output to a file under the plan's scratch folder and read its tail, to protect context.
6. Completion contract, all true with evidence from this session: every named test exists and ran, the task's final test run passed, every Expected line was compared, every deviation has a Ruling line. Then commit with `workspace_git(action:"commit")` and append in the same turn: `Task N: complete (commits <base>..<head>, tests: <command> -> <result>)`.

## 3. Parallel mode (optional, for ticket graphs or independent tasks)

When tasks form a graph with independent branches, work the **frontier** (tasks whose blockers are complete):

- Create an integration branch. Spawn one worker per frontier task with `background_ops(action:"spawn", provider:"openai_codex", model:"gpt-6-sol")` (`gpt-6-luna` for small tasks). Never spawn Anthropic workers from an Anthropic main chat.
- Each worker gets its own worktree on its own branch based on the integration branch, plus context pointers (plan path, task number, ledger path, spec path) instead of pasted content, and the instruction to follow this skill's task loop and `test-first-development`.
- Workers return: branch, commits, test command and result, rulings. Verify their claims from `git log` and a test run; agent "success" is not evidence.
- Merge each finished branch into the integration branch yourself (use `merge-conflict-arbitration` if two workers collide), update the ledger, and spawn workers for newly unblocked tasks.
- Follow `background-coding-agent-lanes` for lane boundaries; never run two workers in the same dirty tree.

## 4. Final review

After the last task:

1. Get a fresh-context review of the whole branch range (merge-base to HEAD) using `independent-fresh-context-review` or `code-review`, passing the plan path, spec path, the Review focus section, and the ledger's Ruling lines. If no fresh reviewer is available, review it yourself in a separate pass and say so plainly in the report.
2. Re-grade findings by effect on a real user, not by whether the spec mentioned the input. Critical and Important go into ONE fix pass; each fix gets a test that fails first, then the full suite must be green. Record `Final: fixed <finding> - <test> RED->GREEN`. Minor findings go to the ledger as deferred and into the report.
3. Run `verification` for user-visible flows.

## 5. Finish

Run the full suite on the exact tree you will integrate. Then send a card via `ask_prometheus_questions`: `Recommended: open a PR` / `Merge locally into <base>` / `Keep the branch as-is`. Confirm the base branch rather than assuming main. PRs go through `connector_github_create_pr` (Prometheus source: `promsrc-pr-worktree`); the gh CLI is not installed. Discarding work requires the user to type the word discard. Never force-push or force-remove a worktree with uncommitted files without explicit consent.

## Exit criteria

Every task has a complete line in the ledger, final review findings are fixed or deferred in writing, the suite is green on the integration tree, the user chose the integration path, and a `write_note` records the plan, ledger, and branch.

Lineage: Inspired by obra/superpowers executing-plans and finishing-a-development-branch (MIT) and mattpocock/skills implement-spec, rewritten for Prometheus.
