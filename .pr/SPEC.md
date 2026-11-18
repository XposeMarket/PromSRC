# SPEC: command output truncation is marked, keeps the tail, and honors maxChars

Tier: 1 (tool output formatting, outside the sensitive areas)
Surface: backend
Parity: n/a (shared gateway handler, all surfaces and all models get the same tool result)
Test: npx tsx src/gateway/agents-runtime/command-output-cap.regression.ts

## Problem
Run and wait results cut command output with `slice(0, 4000)` and add no marker, and they ignore the caller's `maxChars`.
Repro at f3b4bd1f7: `1..1500 | % { "line-$_-abcdefghij" }; "END-MARKER"` with maxChars 12000 ends at `line-196-abcd`. The agent cannot tell output was cut and loses the end, where errors usually are.

## Chosen approach
One helper, `capCommandOutput`, used by every run/wait result site. Under the limit: unchanged. Over the limit: keep head and tail with one marker line naming total chars, omitted chars and the runId for `workspace_run(action:"log")`. Limit comes from `maxChars` / `max_chars`, clamped 1000-100000, default 4000.

## Acceptance
- Output at or under the limit is returned unchanged, with no marker.
- Output over the limit keeps start and end with one marker line (total, omitted, how to read the rest).
- Caller `maxChars` is honored, clamped 1000-100000, default 4000.
- Every run/wait result site uses the helper.
- Regression test asserts the returned string in both directions.

## Files
- src/gateway/agents-runtime/command-output-cap.ts
- src/gateway/agents-runtime/command-output-cap.regression.ts
- src/gateway/agents-runtime/handlers/workspace.ts
- src/gateway/agents-runtime/handlers/misc.ts
- src/gateway/tool-builder.ts

## Risks
- Still-running and wait results used to show only the last 4000 chars; they now show head and tail within the same limit. Noticed as: agents seeing the start of long logs there. Rollback: revert this commit.
- process_wait reads the supervisor log at its default size before capping (was 4000). Small extra cost per poll.
