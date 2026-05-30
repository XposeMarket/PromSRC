# Example: Interrupted AI smoke test / browser target closed (2026-05-23)

## Observed failure

During a CLI AI smoke-test request, the normal tool order reached browser collection but `browser_scroll_collect` failed with:

```text
ERROR: browser_scroll_collect failed: page.evaluate: Target page, context or browser has been closed
```

The chat then emitted a restart/interruption packet instead of a grounded summary.

## Recovery guardrail

If the page/context closes during the smoke test, do not summarize from stale assumptions and do not stop at the first collection failure if the runtime still allows tools. Re-anchor the browser state:

1. Capture a fresh browser snapshot or reopen the intended URL.
2. Retry one bounded collection pass with fewer scrolls/time, e.g. 2-3 scrolls and a shorter delay.
3. If the browser remains closed/unavailable, continue with any already completed desktop-focus evidence and report the exact blocker.
4. If the user interrupts or the runtime restarts, preserve the packet and mark the smoke test incomplete rather than implying the test passed.

## Evidence

- `Brain/skill-episodes/2026-05-23/episodes.jsonl:12-15`
- `Brain/skill-gardener/2026-05-23/live-candidates.jsonl:11-14`
- `audit/chats/transcripts/cli_b17c748f-0469-42e1-ac79-98683bed1d82.md:9-18`
