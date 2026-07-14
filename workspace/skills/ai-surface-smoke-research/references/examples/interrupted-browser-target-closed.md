# Interrupted AI smoke test or closed browser target

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

An explicit stop or steer is authoritative immediately. Stop further browser and desktop actions, report only what completed versus what was skipped, and persist the stopped state across a gateway restart. Never auto-resume until the user explicitly asks again.
