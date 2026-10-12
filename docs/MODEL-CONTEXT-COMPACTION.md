# Model-aware context selection and compaction

## Capacity is not the selected budget

The UI distinguishes model-supported maximum, standard working budget, selected budget, and effective compaction trigger. Provider metadata is preferred, with known model profiles as fallback and configurable overrides for unlisted/local models. Unknown models use a conservative fallback, explicitly labeled by capacity source; there is no universal 200k limit.

Settings on desktop and mobile offer **Standard**, **Maximum**, and **Custom** context. Choices are stored per provider/model/account. Above-standard selection requires an explicit usage acknowledgement in both UI and backend. Settings apply to new turns; running turns retain their admitted route/budget snapshot. A setting is a local request budget, not an entitlement or billing upgrade; provider/account admission can differ.

Codex GPT-6/6.1 catalog evidence separates 272,000 working from 872,000 maximum. Standard stays at 272k until acknowledged opt-in. Direct OpenAI API capacity is separate (1,050,000 for the matched GPT-6 models). Current Anthropic 1M models such as Opus 5.5 use their 1M default. Haiku 5.5 uses a 100k usage-safe standard option because API prompts above 100k use a 5x tariff; 1M is still selectable.

Warnings separate API billing from subscription allowance. OpenAI documents GPT-5.4 Codex 2x subscription usage above 272k; a GPT-6 multiplier is not verified. Current Claude 1M API rates are standard except Haiku 5.5. Claude subscription allowances are account-specific and cannot be inferred from API pricing. Other providers receive an explicit model/account-specific caution rather than an invented universal surcharge.

## Automatic pressure budget

`session.compactionThreshold: "auto"` uses selected usable input capacity after output (up to 32,768), supported reasoning (normally up to 10,000), and estimation margin (5%, capped at 4,096). There is no extra 90% discount. Codex standard 272k therefore has roughly 225k usable input; acknowledged 872k roughly 825k. Actual counts are estimates calibrated to provider usage.

Legacy unmarked 0.7 migrates to auto. Explicit manual markers and other numeric thresholds remain. The UI auto-compaction toggle controls threshold policy, not maximum-context consent. Pre-turn, mid-workflow, and pressure UI use the shared budget; tool-observation growth alone does not compact an otherwise-under-budget thread.

## Adaptive continuity handoff

There is no hard 900-word or 12k-character summary ceiling. Each pass receives the full previous handoff and complete selected source messages, with an adaptive target bounded by the compactor's actual context/output capacity. Substantial input must shrink meaningfully (at least 5%); tiny batches permit schema overhead. A guidance target is not a rejection ceiling.

Ten ordered headings preserve intent, constraints, decisions, evidence, artifacts, pending tasks, current work, and where to resume. Empty, unchanged, explicitly incomplete/truncated, malformed or over-capacity summaries are rejected. The transaction allows one input-budget-checked repair attempt. Every batch and final metadata merge must succeed before the history checkpoint advances; cancellation or failure leaves active history intact. Full accepted summaries are retained in checkpoints/audit artifacts rather than clipped to 12k characters. Raw persisted transcripts remain the recovery authority for verbatim details.

Validation can prove structure, budget fit, shortening and atomic checkpoint behavior, not perfect semantic retention by an LLM. No real 872k/1M provider admission or physical-phone end-to-end test has been claimed. Desktop/mobile controls have local browser regression coverage at 320, 390 and 1280 pixels.
