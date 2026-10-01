---
name: receiving-code-review
description: Evaluate and act on code review feedback (from the user, a PR reviewer, a bot, or a review agent) with technical verification instead of performative agreement - restate, verify against the codebase, push back with evidence, clarify all unclear items first, then fix one item at a time with tests. Use when given review comments to address; not for performing a review yourself.
---

# Receiving Code Review

Review feedback is a set of claims to check, not orders to follow or praise to answer. Technical correctness beats social comfort.

## 1. Collect the whole review first

- Gather every item before reacting. For a GitHub PR: `connector_github_get_pr`, plus `connector_github_api_request` for `GET /repos/{owner}/{repo}/pulls/{n}/comments` (inline) and `/pulls/{n}/reviews`. The gh CLI is not installed. For Prometheus source PRs, the repo is `XposeMarket/PromSRC` and work happens in the worktree per `promsrc-pr-worktree`.
- Number the items. For each, restate the technical requirement in one line in your own words.

## 2. Clarify before implementing anything

If ANY item is unclear, implement nothing yet; items are often related and partial understanding produces wrong fixes. Ask all unclear items in one `ask_prometheus_questions` card (1 to 3 questions; more cards if needed), with your best interpretation as the first option, e.g. `Recommended: item 4 means rename the param, not change its type`.

## 3. Verify each item against reality

For each item, check with one multi-pattern `workspace_read(action:"grep")` and targeted reads (`fast-coding-loop`):

- Is it technically correct for THIS codebase, stack, and platform targets?
- Would it break existing behavior or a public contract?
- Is there a reason the current code is this way (`workspace_git(action:"log")`, blame, comments, ADRs)?
- Does the reviewer have the full context?
- YAGNI: for "implement this properly" requests, grep for real callers. If nothing uses it, propose removal instead of building it out.
- Does it conflict with a decision the user already made? If so, stop and ask the user before acting.

Classify each item: **accept**, **push back**, **needs user decision**, or **cannot verify** (say exactly what would be needed to verify it).

## 4. Respond with substance

- Accepted: state the fix, not gratitude. "Fixed: <what changed> in <file>." or simply show it in the diff.
- Push back: give technical reasoning with evidence (code reference, test, version constraint), and ask a specific question if useful. Example shape: "Checked: build targets <version>, this API needs <newer>; keeping the fallback. Want to drop older support instead?"
- If you pushed back and were wrong: say what you checked and that you are fixing it, in one line. No long apology.
- Forbidden: "You're absolutely right", "Great point", "Thanks for catching that", or "Let me implement that now" before verification.
- The user's own feedback is trusted after understanding, but still clarify scope and still skip the flattery.

## 5. Implement in order, one at a time

1. Blocking issues (breakage, security).
2. Simple fixes (typos, imports, names).
3. Complex fixes (logic, refactors).

After each item, run the narrowest relevant test (`workspace_run`). For behavior changes, write the failing test first (`test-first-development`). After all items, run the full relevant suite once and check for regressions.

## 6. Report and reply

- Report to the user: a table of item, verdict (fixed / pushed back / needs decision / deferred), evidence, and test results.
- Reply on GitHub only when the user authorizes it. Reply in the inline thread, not as a top-level comment: `connector_github_api_request` with `POST /repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies`. Use `connector_github_comment` only for general PR comments. For thread resolution state, see `github-gh-address-comments`.
- Commit and push through `workspace_git` (or the `promsrc-pr-worktree` flow).

## Exit criteria

Every item has a recorded verdict backed by a code check, unclear items were clarified before any edit, accepted fixes are tested, and no performative agreement appears in replies.

Lineage: Inspired by obra/superpowers receiving-code-review (MIT), rewritten for Prometheus.
