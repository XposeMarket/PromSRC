# Browser automation benchmark and Pass A stabilization

The 2026-07-11 external benchmark exercised all four browser wrappers across
35 calls. It measured 24.032 seconds of cumulative tool execution, 24,228
argument/result tokens, and an estimated $0.030293 context cost. One unbounded
network read accounted for 16,182 tokens and roughly two thirds of the total.

## Pass A changes

- Network response bodies are omitted by default. Callers can opt in with
  `include_bodies`, cap each body with `body_max_chars`, filter status ranges,
  filter URLs, and limit returned entries.
- Console reads are scoped to the current page by default and support timestamp
  and URL cursors. Smoke tests clear console state and establish a new cursor
  before navigation.
- `focused_item` now reports `document.activeElement` generically. X/Twitter
  tweet context is retained only as site-specific enrichment.
- `new_tab` waits for document readiness/useful content and returns URL, title,
  readiness, response status, body size, and tab index from the same page.
- Structured extraction errors return a complete minimum-valid schema on the
  first failure. Unsupported field types are rejected instead of silently
  degrading to text, and saved schemas are labelled domain-scoped.
- `scroll_collect` applies `max_chars` inside page extraction and before text is
  appended, so the initial page cannot exceed the ingestion budget.
- Deterministic browser actions retain `observe="none"` as the fast path and
  now expose `fast:true` as a clear alias. Existing approval/safety behavior is
  unchanged.

## Verification

Run `npm run test:browser`. The contract suite verifies the four-wrapper
surface, fast-action defaults, network body opt-in/caps, console page scoping,
and structured-extraction validation examples.

A disposable live data-URL test encountered an environment-level Chrome
startup/attachment stall and was terminated. The benchmark-owned Chrome root
process was cleaned up without touching normal user Chrome profiles.

## Full benchmark follow-up

- Network interception now attaches to the Playwright browser context rather
  than one page, so localhost navigation and newly selected/created tabs remain
  observable after the listener starts.
- Accessibility checks compute effective names from ARIA, `aria-labelledby`,
  native control text, associated labels, title, alt, value, and placeholder.
- Smoke tests accept declarative `click`, `fill`, `key`, `assertText`, and
  `assertVisible` steps and stop on the first failed assertion.
- `workspace_run(action="status")` optionally probes `health_url`/`port`,
  distinguishes process liveness from service health, reports the listening
  PID, and includes recent stdout/stderr.
- `workspace_run(action="telemetry")` returns automatically persisted aggregate
  telemetry with wall/cumulative time, calls, success/failure counts, tokens,
  estimated cost, p50/p95, per-tool/action buckets, largest payloads, and error
  taxonomy.
