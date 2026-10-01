---
name: "independent-fresh-context-review"
description: "Get a genuinely independent second opinion on finished work (code, a report, a plan, a design, research) by handing a written brief to a fresh-context reviewer agent that never saw how the work was produced. Use when the user wants an independent, fresh-eyes, or second-opinion review before shipping. Not for a normal diff review in the current context (code-review) or for acting on review feedback (receiving-code-review)."
---

# Independent Fresh-Context Review

A reviewer who watched the work being made inherits its blind spots. Hand off evidence, not reasoning.

## 1. Write the brief

Save `review-brief.md` next to the artifact (or under `reviews/<slug>/`) with:

- **Objective:** what the work was supposed to achieve, in the user's words.
- **Acceptance criteria:** numbered, each checkable.
- **Artifacts:** exact paths, URLs, commits, or PR numbers to inspect.
- **Decisions made:** one line each, so the reviewer can challenge them.
- **Known doubts:** where you are least sure.
- **Evidence already produced:** tests run, outputs, screenshots, with paths.

Leave out persuasive narrative and the reasons you believe it is correct.

## 2. Spawn the reviewer

`background_ops({action:"spawn", provider:"openai_codex", model:"openai_codex/gpt-6-sol", reasoning_effort:"high", tool_categories:[...what inspection needs, e.g. "workspace_write", "browser_automation"], prompt})`. Never spawn Anthropic models while main chat runs on Anthropic. The prompt is self-contained: the brief path, instructions to read the real files and run read-only checks, and the required output below. The producer of the work is never the reviewer.

## 3. Reviewer output contract

- Each criterion: **confirmed**, **disproven**, or **unresolved**, with the evidence (file:line, command output, screenshot path).
- Findings ranked by impact, each with a concrete fix direction.
- Exactly one verdict: **verified**, **needs remediation**, or **blocked** (state what blocks it).
- "Looks good" with no evidence is not an acceptable answer.

## 4. Act on it

Read the reviewer's evidence yourself before relaying it; agent reports are claims until checked. Fix confirmed findings, then re-check only the affected criteria (a second spawn if the fix was substantial). Report the verdict, what changed, and anything still unresolved.
