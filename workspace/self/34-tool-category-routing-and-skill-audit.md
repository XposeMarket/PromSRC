# Tool-category routing and skill audit

Date: 2026-08-09

Scope: automation workflow-pack split, compact category/menu prose, tightened deterministic category activation, and a focused skill-routing audit. No external browser/desktop/app side effects are part of this benchmark.

## Current implementation

- `src/runtime/tool-category-keyword-router.ts` is the fast, side-effect-free intent router. It only activates categories for actionable requests and deliberately does not perform memory search, skill reads, model calls, filesystem reads, or network calls.
- `src/gateway/prompt-context.ts` keeps the previous detector as `detectLegacyToolCategories` for regression/reference comparison, but runtime detection uses the new router.
- `src/gateway/chat/chat-helpers.ts` activates canonical categories only. Hidden Prometheus source categories are filtered by the runtime distribution gate; workspace routing remains available in workspace-first mode.
- `src/runtime/tool-category-manifest.ts` owns four automation packs:
  - `automation_scheduling`
  - `automation_tasks`
  - `automation_recovery`
  - `automation_sessions`
- Requesting legacy `automations` remains compatible and expands to all four packs. Requesting a specific pack exposes only that pack’s non-core tools.
- `request_tool_category` remains the model fallback. Its category enum and compact description include the four pack IDs.
- The always-present `[TOOLS]` menu does not list every pack ID; this preserves the stable 13,428-character base menu. Pack IDs remain available through the request-tool schema and active-category state.

## Category-routing benchmark

Benchmark: 53 diverse prompts, 42 positive cases, and 11 negative/no-tool cases. The “before” detector is the previous in-repo heuristic; the “after” detector is the new compiled router.

| Measure | Before | After |
|---|---:|---:|
| Required positive routes | 27/42 (64.29%) | 42/42 (100%) |
| Negative prompts with no operational category | 3/11 (27.27%) | 11/11 (100%) |
| Exact positive route sets | — | 31/42 (73.81%) |
| Router time per case, compiled benchmark | 0.05909 ms | 0.02932 ms |

The exact-set score is lower than the required-route score because some prompts intentionally activate two valid layers, such as workspace plus Prometheus-source read, or source read plus source write for a fix. The important safety result is that every positive case got its required category and every negative case stayed clean.

Examples corrected by the router:

- “Tell me a joke about automation.” → no category.
- “What is a schedule in general?” → no operational category.
- “The website looks beautiful today.” → no browser activation.
- “I have a window of time tomorrow.” → no desktop activation.
- “Schedule the report every weekday at 8am.” → `automation_scheduling`.
- “What tasks are currently running?” → `automation_tasks`.
- “My request got cut off; recover the existing run.” → `automation_recovery`.
- “Create a new Prometheus chat thread.” → `automation_sessions`.
- Explicit Prometheus `src/gateway`, `src/runtime`, `src/config`, and `web-ui/src` paths → source/workspace routing; ordinary user-project `src/components` paths remain workspace routing.

## Automation schema and prose measurements

Tool-schema tokens are Prometheus’s estimated JSON-schema tokens (`estimateToolSchemaTokens`), not provider-billed tokens. The earlier broad-automation reference was 35 tools, 58,907 JSON characters, and about 14,727 estimated tokens.

| Activation | Tools | JSON chars | Est. schema tokens | Change vs old broad automation |
|---|---:|---:|---:|---:|
| Legacy `automations` compatibility path | 35 | 58,402 | 14,601 | approximately unchanged surface |
| `automation_scheduling` | 28 | 37,731 | 9,433 | −21,176 chars / −5,294 tokens |
| `automation_tasks` | 25 | 38,207 | 9,552 | −20,700 chars / −5,175 tokens |
| `automation_recovery` | 23 | 31,280 | 7,820 | −27,627 chars / −6,907 tokens |
| `automation_sessions` | 22 | 36,645 | 9,162 | −22,262 chars / −5,565 tokens |

The core surface remains 21 tools. Its current measurement is 28,487 JSON characters / 7,122 estimated schema tokens. A prior investigation recorded 28,992 / 7,248; that small core difference is not attributed to this pack change because the core schemas and broader worktree were already changing independently.

Prompt/prose measurements:

- `request_tool_category` description: 1,957 → 1,361 characters; about 490 → 341 estimated text tokens; −30.5%.
- Broad automation policy block: 2,248 → 249 characters; about 562 → 63 estimated text tokens; −88.9%.
- Current pack policy blocks: scheduling 224 chars, tasks 177, recovery 268, sessions 261. Shared automation safety is emitted once for explicit pack activation.
- Base `[TOOLS]` context: 13,428 chars / 3,357 estimated tokens before and after. Pack names are intentionally not added to that always-loaded prefix.
- Broad legacy automation prompt with pack-specific rules: 14,768 chars / 3,692 estimated tokens, versus roughly 15,676 chars / 3,919 tokens from the prior base plus broad policy; −908 chars / −227 estimated tokens.

Input cost is proportional to the provider’s input-token price. No provider tariff is assumed here; at a hypothetical `$P` per million input tokens, a schema delta of `N` tokens changes cost by `N × P / 1,000,000` per request.

## Skill audit and changes

Existing safety behavior remains intact:

- 552 fixture cases: 552/552 exact, 100%.
- Automatic skill instruction injection remains disabled; matching metadata only produces candidates, and `skill_read` is still required.
- 158 installed catalog skills were loaded for the real-catalog check.
- 13 representative natural requests: 13/13 expected top skill matches.
- Definition/noise cases do not leak `market-research`.
- Explicit-only skills such as HyperFrames and social-intelligence remain explicit-only; they were not broadened.

Targeted manifest corrections were made in `workspace/skills/.manifests/`:

- `web-researcher`: replaced three less useful triggers with `latest web research`, `research current facts online`, and `find current web sources`.
- `scheduler-operations-playbook`: added `schedule recurring job`, `diagnose scheduled job stuck`, and `inspect scheduled job history` while staying within the 12-trigger cap.
- `market-research`: added `market research` while preserving competitor-profile separation.
- `mcp-ops-troubleshooting`: added `mcp server failed to connect`; it now outranks the builder skill for failure requests while the builder still wins creation requests.

All three touched skill folders pass the skill creator validator with UTF-8 mode enabled. The trigger additions are multi-word and were tested with positive and adjacent negative requests; no broad single-word triggers were added.

## Remaining decisions / risks

1. The broad `automations` alias still loads all automation tools. This is intentional backward compatibility. If the product wants maximum savings, the next product decision is whether to stop advertising/accepting the broad alias after a migration period.
2. A category router cannot resolve every ambiguous phrase. The model-facing `request_tool_category` fallback must remain enabled; it is the safe escape hatch for novel wording.
3. The benchmark measures deterministic routing and schema assembly. It does not claim provider-billed token counts or end-to-end first-token latency. The router itself adds no model or retrieval round and measured below 0.05 ms per case.
4. The skill catalog still has legitimate domain collisions. The system intentionally surfaces candidates rather than injecting instructions; keep the “read at most one genuinely relevant skill” gate.

## Regression commands

```text
npm run build:backend
npm run test:tool-category-routing
npm run test:skill-catalog-routing
npm run test:tool-category-manifest
npx tsx src/runtime/instruction-intent-benchmark.regression.ts
node dist/runtime/tool-category-routing.regression.js
node dist/runtime/skill-catalog-routing.regression.js
```

The compiled gateway was rebuilt and restarted after the changes; `/api/health` returned `ok: true` on the new process.
