# Brain Continuity Implementation Design — 2026-07-18

## Objective
Connect six-hour Brain Thoughts to ordinary runtime context, then let the nightly Dream rewrite unresolved temporary work into the next day's existing intraday-notes file without promoting short-lived work into permanent memory.

## Lifetime layers
1. **Thought artifact:** full evidence-backed retrospective Markdown.
2. **Thought capsules:** zero or more machine-readable records embedded in every successful Thought. Capture count is evidence-driven and has no fixed item limit.
3. **Runtime injection:** relevant, non-expired capsules selected against the current message under a token/character budget. Storage is not capped by prompt limits.
4. **Dream carry-forward:** one generated section at the top of the next day's normal `memory/YYYY-MM-DD-intraday-notes.md`; it is rewritten from current evidence, never copied blindly.
5. **Durable memory:** only items passing the existing durable/new/evidenced/actionable gate.

## Thought capsule contract
Each record has `id`, stable `threadKey`, `kind`, `priority`, `status`, timestamps, `expiresAt`, `summary`, `facts`, `nextUsefulAction`, relevance terms/projects/surfaces, evidence, `lastValidatedAt`, `verificationRequired`, and optional `supersedes`.

Thought may emit as many distinct capsules as reality supports. It must merge duplicate activity under one `threadKey`, omit completed micro-actions with no future implication, and never use an arbitrary top-N output rule.

## Runtime selection
- Read capsules from recent Thought artifacts.
- Validate schema and expiry.
- Resolve duplicate `threadKey` records newest-first; honor `supersedes`.
- Score lexical/project relevance against the current user message.
- Inject relevant records only, bounded by characters; a small high-priority fallback is allowed when no lexical match exists.
- Capsules are hints, not truth; unverified work carries an explicit live-state-check instruction.

## Dream carry-forward contract
Dream reads today's raw notes, all Thought findings/capsules, the previous carry-forward section, Active Work Ledger, task/proposal/job evidence, and durable memory for dedupe. For every temporary thread it chooses `refresh`, `hold`, `resolve`, `expire`, `escalate`, or `promote`.

The Dream creates tomorrow's existing intraday note with a generated opening section. There is no fixed item-count cap. Every item must include stable thread key, state, verified facts, loose ends, next natural opening, expiry/review date, evidence, and validation status.

The section must explicitly instruct all writers: **note when/if any carry-forward item changes, completes, becomes blocked, or is superseded so the next Thought/Dream can update or remove it.** Normal notes append below a `## Live Notes` marker immediately during the day.

## Safety rules
- A thread cannot renew itself solely because it appeared yesterday.
- Refresh requires fresh user activity, a newer Thought, or verified live state.
- Speculation remains labeled and expires quickly.
- Prompt injection is bounded; artifact and carry-forward capture are not item-count capped.
- The Dream writes via an atomic replacement helper and preserves any live notes already present if a late/catch-up Dream targets a file that exists.
- `write_note` always appends under the existing daily file and therefore preserves the generated header.

## Acceptance evidence
- Typed parser/selector handles unlimited stored capsules, expiry, dedupe, relevance, and output budget.
- Thought prompt requires the capsule block and allows any evidence-supported count.
- Dream prompt requires next-day carry-forward creation/rewrite and the change-notification instruction.
- Dream mutation scope permits only the calculated next-day intraday file in addition to existing outputs.
- Prompt assembly injects selected capsules separately from processed intraday notes.
- Regression tests cover parsing, supersession, expiry, relevance, budget, carry-forward preservation, and intraday processing.
