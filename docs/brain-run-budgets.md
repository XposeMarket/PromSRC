# Brain Dream / cleanup safety contracts

Dream and cleanup use shared backend limits across desktop, web/mobile and channels. Defaults are **20 model requests** and **1,500,000 input tokens** per run. Override with `PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS` and `PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS` in the gateway environment; invalid/non-positive values retain defaults. These do not change the configured Brain model.

The runtime checks each request before admission, including message and tool-schema token estimates, and reconciles provider-reported prompt usage afterward. It blocks the next request if actual usage reaches the cap. Provider tokenization is only known after a response, so a single admitted request may exceed its estimate; provider-internal transport retries/server-side reasoning are not separate gateway model rounds. When exhausted, it stops asking the model for further work; the runner preserves existing output or writes a deterministic partial report and records the budget reason. This is not an operator abort, and a budget-truncated report is not evidence that deferred work completed.

Dream reads the target window's Thought Markdown summaries first. It selects at most three concrete unresolved questions for bounded raw-evidence drill-down; missing summaries are reported rather than triggering wholesale activity-package replay.

Curator rejection is an action, not prose: `skill_curator` with `action: "reject"` and `id`. The durable record retains the id, normalized proposed-content fingerprint and 90-day suppression expiry. Formatting-only duplicates/new ids and already queued identical content are suppressed. The default status queue contains pending/quarantined items only; use `statusFilter: "rejected"` for audit. Restore explicitly with `action: "restore", id`, or allow the 90-day expiry to reconsider. Different proposed behavior receives a different fingerprint. No existing skill mutation is authorized by this policy.

Thought artifact directories and filenames both describe the local **window start**, not UTC or the later catch-up execution time. Their `YYYY-MM-DD/HH-mm-thought.md` shape remains unchanged; historical files are not renamed. Dream's date reader and the recent-thought folder walker continue using the same globs.

Follow-ups intentionally excluded: oversized continuation-only activity packages/assembly latency, Brain model selection, and the memory-write gate.
