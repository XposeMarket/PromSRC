# Model-aware context compaction

`session.compactionThreshold: "auto"` is the default for new profiles. It uses the selected model's usable input budget, not a universal 70% raw-history gate. Usable input reserves generation output (up to 32,768 tokens), supported reasoning (normally up to 10,000), and one estimation margin (5%, capped at 4,096); no additional 90% compaction discount applies.

Codex GPT-6/6.1 astra, sol, and luna use the verified 872,000-token catalog maximum, not the 272,000 working default. GPT-5 Codex remains 272,000. The direct OpenAI API profile is unchanged (1,050,000); Codex evidence is not used to alter a separate provider's limit. Runtime metadata's valid supported maximum takes priority over its working window; explicit configured context overrides take priority over metadata. Provider limits and supported reasoning still apply.

The legacy default 0.7 migrates to auto unless `compactionThresholdMode: "manual"` explicitly marks it. Other numeric thresholds remain manual overrides. This migration intentionally upgrades old default profiles; historical unmarked intentional 0.7 choices cannot be distinguished and should be re-saved with the manual marker. In mobile model settings, enable **Use full model context** and save to opt into auto sizing; turn it off to use a manual 0.4–0.95 threshold. APIs accept `"auto"` or a number and return an effective threshold alongside the policy.

The session pre-turn gate, mid-workflow budget, and context-pressure endpoint share the same trigger formula. Actual token counts remain estimates calibrated to provider usage; message count is not the context limit.

## Compaction failure safety

Recent runtime logs showed repeated `mid_workflow_token_budget: invalid_summary` rejections. The old summary prompt specified a token target without declaring the separately enforced hard word cap. Prompts now state the exact word cap (including headings), normalize decoration only on the ten known section headings, and allow one input-budget-checked repair attempt. Empty, unchanged, truncated, overlong, or semantically empty handoffs still fail; rejected transactions never advance the retained-history checkpoint. Diagnostics record reason, word/character counts and actual attempt numbers, not summary content. Cancellation is forwarded to the provider.

Tool-observation growth alone no longer triggers whole-thread compaction while the active request is below its shared model budget. Tool-result bounding remains separate.
