## 20) Providers and Provider Registry

Provider selection is now extension-descriptor driven through `src/providers/provider-registry.ts`, not just a small hardcoded factory list.

Registry helpers now expose:

- provider descriptors
- known provider IDs
- secret field lists
- provider static model lists

Bundled provider extension directories currently include:

- `anthropic`
- `arcee`
- `deepseek`
- `gemini`
- `huggingface`
- `kilocode`
- `llama_cpp`
- `lm_studio`
- `minimax`
- `moonshot`
- `nvidia`
- `ollama`
- `openai`
- `openai_codex`
- `opencode`
- `opencode-go`
- `openrouter`
- `perplexity`
- `qwen`
- `vercel-ai-gateway`
- `xai`
- `xiaomi`
- `zai`

The config schema explicitly validates provider-specific structures for:

- `ollama`
- `llama_cpp`
- `lm_studio`
- `openai`
- `openai_codex`
- `anthropic`
- `perplexity`
- `gemini`

## 21) Model Configuration and Presets

Current default LLM config in source:

- active provider default: `ollama`
- default Ollama model: `qwen3:4b`
- default OpenAI Codex model: `gpt-5.5`
- default OpenAI API model: `gpt-5.5`
- OpenAI Codex and OpenAI API static model lists expose the official GPT-5.6 preview model IDs published by OpenAI: `gpt-5.6-sol` (flagship), `gpt-5.6-terra` (balanced), and `gpt-5.6-luna` (fast/low-cost). Do not expose invented aliases such as `gpt-5.6`, `gpt-5.6-codex`, `gpt-5.6-codex-mini`, or plain `sol`; OpenAI's preview help article lists only the three fully-qualified IDs for API and Codex. GPT-5.6 preview access is separately provisioned for approved API organizations and Codex workspaces, so `gpt-5.5` remains the safe default/fallback until the active account is enabled.
- Official GPT-5.6 preview pricing per 1M tokens: Sol $5 input / $30 output, Terra $2.50 input / $15 output, Luna $1 input / $6 output. GPT-5.6 cache writes are billed at 1.25x uncached input and cache reads keep the 90% cached-input discount.

- native Anthropic exposed models start with `claude-opus-4-8`, then preserve the current Opus/Sonnet/Haiku models
- legacy `models.primary`: `qwen3:4b`
- legacy role defaults (`manager`, `executor`, `verifier`): all `qwen3:4b`

Provider/model settings surfaces:

- `GET/POST /api/settings/provider`
- `GET/POST /api/settings/model`
- `GET/POST /api/settings/agent-model-defaults`
- `POST /api/models/test`

Agent/model default keys currently supported:

- `main_chat`
- `proposal_executor_high_risk`
- `proposal_executor_low_risk`
- `manager`
- `team_manager`
- `subagent`
- `team_subagent`
- `background_task`
- `subagent_planner`
- `subagent_orchestrator`
- `subagent_researcher`
- `subagent_analyst`
- `subagent_builder`
- `subagent_operator`
- `subagent_verifier`
- `switch_model_low`
- `switch_model_medium`
- `coordinator`
- `background_agent`

Other current model facts:

- `switch_model` is turn-scoped, not a global config save
- its exposed tiers are `low` and `medium`
- OpenAI, OpenAI Codex, and Perplexity provider config support `reasoning_effort`
- validated reasoning efforts include `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; GPT-5.6 introduces `max` reasoning effort, while older providers/models may normalize or ignore unsupported values.
- Anthropic provider config supports `extended_thinking` and `thinking_budget`

Provider-aware context budgeting lives in `src/gateway/context/model-context.ts`.

Current context-profile behavior:

- `resolveActiveModelContextProfile(...)` reads the active provider/model from config and returns `providerId`, `model`, `contextWindowTokens`, `maxOutputTokens`, tokenizer family, reasoning-token support, reasoning budget, and source
- profile sources are `config_override`, `provider_metadata`, `known_table`, `ollama_num_ctx`, or `fallback`
- provider config overrides can set `context_window` / `contextWindowTokens`, `max_output_tokens` / `maxOutputTokens`, `reasoning_budget_tokens` / `thinking_budget`, and `tokenizer`
- provider metadata can supply `contextWindowTokens`, `maxOutputTokens`, and tokenizer when available
- Ollama context can come from configured `num_ctx`, `LOCALCLAW_SESSION_NUM_CTX`, or `LOCALCLAW_CHAT_NUM_CTX`
- tokenizer families are `openai`, `anthropic`, `gemini`, `llama`, `qwen`, and `heuristic`

Known context table facts:

- OpenAI/OpenAI Codex `gpt-5*` and Codex-named models are currently treated as 400k context with 128k max output
- OpenAI/OpenAI Codex `gpt-4.1*` is treated as about 1,047,576 context with 32,768 max output
- OpenAI/OpenAI Codex `gpt-4o` and `o*` models are treated as 128k context
- Anthropic `claude-opus-4-8` is treated as 1m context with 128k max output
- Anthropic `claude-*` models are treated as 200k context
- Gemini `gemini-*` models are treated as 1m context
- xAI static models include `grok-build-0.1`, the OAuth/subscription-gated `grok-composer-2.5-fast` Composer 2.5 id, and current Grok 4.x ids. Composer 2.5 is available in Grok Build to SuperGrok/X Premium+ and may be absent from public `/v1/models`, so keep it as a curated static model while live model discovery remains enabled.
- Perplexity sonar models and xAI Grok/Composer models currently fall back to 128k known-table entries unless overridden or provider metadata says otherwise
- unknown local/llama providers fall back lower, currently 8192; unknown cloud-ish providers fall back to 32768

Budget math:

- `buildContextBudget(...)` reserves output tokens, reasoning tokens when supported, and 10% safety headroom
- usable input budget is context minus reserved output, reasoning, and headroom
- compaction triggers at 75% of the usable input budget
- recent tool context budget is about 16% of usable input budget, with a 600-token floor
- summary budget is about 8% of usable input budget, with a 700-token floor

Token counts are estimates, not provider-billed truth. `estimateTextTokensForModel(...)` uses character-density heuristics by tokenizer family and gives denser code/log text a smaller divisor. Provider usage metadata should be used for calibration where available, but UI/context decisions should still tolerate approximation.

Codex Spark usage handling (2026-07-10):

- OpenAI documents GPT-5.3-Codex-Spark as a separate model with its own model-specific usage limits rather than the standard Codex allowance.
- `src/providers/provider-usage-limits.ts` parses `additional_rate_limits[]` from the authenticated `wham/usage` response. The Spark lane is identified by `limit_name: GPT-5.3-Codex-Spark` (with the provider feature identifier accepted as a fallback) and normalized into 5-hour/weekly windows.
- Spark windows replace the standard Codex windows only when `openai_codex` and `gpt-5.3-codex-spark` are the currently configured main-chat provider/model. Agent defaults, secondary assignments, or merely having Spark in the catalog must not expose the Spark allowance.
- The provider payload marks this with `usage_scope: "model"` and `usage_model: "gpt-5.3-codex-spark"`; otherwise usage remains `usage_scope: "provider"`.
- Desktop chat, mobile chat, Models settings, and Hub reuse the same gated provider payload. If OpenAI omits the selected Spark lane, those surfaces show a Spark-specific unavailable state rather than incorrectly displaying standard Codex usage or local token totals.

Anthropic extended-thinking request shape:

- Opus 4.7 and newer Opus aliases use adaptive thinking (`thinking: { type: "adaptive" }`) with high effort output config instead of legacy `budget_tokens`.
- Older supported Claude thinking models continue to use the configured `thinking_budget`.
- The native Anthropic extension does not carry a descriptor-level static model list; `AnthropicAdapter.listModels()` returns the known native model set. Aggregator descriptors keep static fallback lists in their provider-specific ID formats.
