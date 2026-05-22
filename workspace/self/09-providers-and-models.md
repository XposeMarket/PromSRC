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
- default OpenAI Codex model: `gpt-5.4`
- default OpenAI model: `gpt-4o`
- default Anthropic model: `claude-sonnet-4-6`
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
- validated reasoning efforts include `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`
- Anthropic provider config supports `extended_thinking` and `thinking_budget`
