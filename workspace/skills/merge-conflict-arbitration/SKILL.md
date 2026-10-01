---
name: merge-conflict-arbitration
description: Resolve git merge or rebase conflicts as a neutral arbiter - recover both sides' intents, classify every conflicted hunk (disjoint, same question different answer, superseded), resolve only inside conflict regions, verify both intents survive, and hand back a per-hunk decision log. Use for conflicts between parallel agents, branches, or PRs; not for regenerable lockfiles or for ordinary single-author git operations.
---

# Merge Conflict Arbitration

Whoever wrote one side tends to overwrite the other side or abandon their own change. An arbiter reconciles both from stated intent, touches nothing else, and surfaces every design call so a human can veto it.

## When to use

- `git merge` or `git rebase` stopped on conflicts between two branches, two agent lanes, or two PRs.
- Parallel workers from `implementation-plan-execution` or `background-coding-agent-lanes` collided.
- Not for lockfiles or generated files: regenerate those with the project's tool. Not for routine git chores: use `git-workflow`.

Best shape in multi-agent work: a third, neutral worker arbitrates, not either author. Spawn it with `background_ops(action:"spawn", provider:"openai_codex", model:"gpt-6-sol")`, passing the repo path, both branch names, and both intent summaries verbatim, plus the instruction to follow this skill. Never spawn Anthropic workers from an Anthropic main chat. If you authored one side, say so and weigh the other side's intent deliberately.

## 1. Gather both sides

Using `workspace_run` / `workspace_git` in the repo (Prometheus source: the worktree from `promsrc-pr-worktree`, never the live checkout):

- `git status` to confirm the conflicted state and list files. In a halted merge, `HEAD` is one side and `MERGE_HEAD` the other (during a rebase they are swapped: `HEAD` is the upstream being replayed onto).
- `git merge-base A B`, then for each side `git log --oneline <base>..<side>` and `git diff <base>..<side> -- <file>` for each conflicted file.
- Intent per side: PR bodies (`connector_github_get_pr`), plan or ticket text, worker completion summaries, else commit messages. Write one sentence of intent per side before editing anything. If neither intent is recoverable, escalate instead of guessing.

## 2. Classify every hunk

Open each conflicted file (`workspace_read`) and find every `<<<<<<<` / `=======` / `>>>>>>>` block. Give each hunk exactly one class, judged by the stated intents rather than which code looks nicer:

| Class | Meaning | Resolution |
|---|---|---|
| disjoint | Different goals that can coexist | Combine both fully |
| same question, different answer | Both sides answered one design question differently | Pick ONE answer that best serves the stated intents; surface it |
| superseded | One side's premise no longer holds after the other's change | Keep the survivor; note why |

Classify per hunk, never per file. If one hunk mixes independent decisions, split it into sub-decisions and classify each. Write a one-line rationale per hunk.

## 3. Resolve under the impartiality rules

- Edit with `workspace_edit` (`find_replace` or `patchset`), only inside conflict regions. No formatting, renames, or opportunistic fixes elsewhere.
- Never split the difference into a hybrid neither side designed.
- If intents genuinely tie on a design question, ask the user with `ask_prometheus_questions`: state the question, put your recommended side first, the other side second.
- Stage each resolved file. Done when a `workspace_read(action:"grep", pattern:"<<<<<<<")` over the repo returns nothing and all resolved files are staged.

## 4. Verify

Run the project's build and tests (`workspace_run`); at minimum load or import the touched modules. Both intents must be observable in the merged behavior, or the dropped one is named explicitly. Then complete the merge or `git rebase --continue`, with a commit body listing the hunk decisions. Never `git reset --hard`, `--abort` away work, or force-push without the user's explicit consent.

## 5. Hand back

Deliver a decision log, one line per hunk: `file:lines | class | side(s) kept | rationale`. For every same-question hunk, state the design question and the chosen answer so it can be vetoed. Flag repeat conflicts on the same file across rounds as a hotspot that the plan should decompose, rather than reconciling it again and again. Record a `write_note`.

## Exit criteria

Clean `git status` with the merge or rebase completed, no conflict markers, build and tests passing, and a log covering every hunk.

Lineage: Inspired by NousResearch hermes agent-merge-conflict-arbiter (MIT), rewritten for Prometheus.
