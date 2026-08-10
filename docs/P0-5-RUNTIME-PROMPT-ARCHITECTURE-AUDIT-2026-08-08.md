# P0-5 Runtime Prompt Architecture Audit

Date: 2026-08-08  
Status: investigation and recommendation only  
Scope: local Prometheus source, configuration, workspace/self documentation, and local prompt telemetry

## Executive finding

Prometheus does not have one runtime prompt. It has a layered prompt system with separate builders for the main chat, scheduled work, autonomous/background work, isolated agents, teams, the voice worker, realtime voice orientation, Brain Thoughts, recovery/repair analysis, and a legacy task path. The architecture already has useful isolation and cache boundaries, but several surfaces still inherit more context than their job requires.

The largest current budget item is the newly implemented six-hour Thoughts activity package. That package is intentionally direct, authoritative context for a Thought and correctly records provenance, omissions, caps, and continuation files. The latest package measured approximately 220,000 compact serialized characters, or roughly 55,000 tokens using the repository's `characters / 4` estimate. The unresolved-work section alone was approximately 117,000 compact characters. This is not evidence that the package's role should be removed; it is evidence that the amount of authoritative activity data placed inline needs an explicit product/budget decision.

The next largest issue is the baseline prompt surface. A recent real main interactive manifest contained about 20,400 estimated system tokens and 22,300 estimated tool-schema tokens before ordinary conversation/tool-result growth. Recent local aggregates were approximately 22,300 system plus 23,800 schema tokens for main interactive calls, and approximately 26,300 system plus 4,700 schema tokens for cron calls. These are comparative estimates, not provider billing numbers.

No source, configuration, or runtime behavior was changed for this audit. This report is the only intended artifact change.

## 1. Scope and evidence method

The workspace/self material was read first, including:

- `workspace/self/index.md`
- `workspace/self/21-runtime-prompt-map.md`
- `workspace/self/22-runtime-prompt-verbatim.md`
- `workspace/self/23-runtime-context-flow.md`
- `workspace/self/26-runtime-instruction-census.md`
- `workspace/self/29-agent-identity-and-memory-runtime.md`
- `workspace/self/30-runtime-process-isolation.md`
- `workspace/self/31-thought-activity-package.md`
- `workspace/self/02-startup-runtime.md`, `03-execution-and-prompting.md`, `06-image-voice.md`, `08-tasks-and-agents.md`, `11-run-and-supervisor.md`, `12-telegram-and-brain.md`, `13-memory.md`, `14-skills-and-frontend.md`, `15-paths-and-sharp-edges.md`, and `19-onboarding-system.md`
- the relevant `workspace/self/feature-index/` architecture and runtime maps

The code audit then followed prompt construction and dispatch into:

- `src/gateway/prompt-context.ts`
- `src/gateway/routes/chat.router.ts`
- `src/gateway/chat/chat-helpers.ts`
- `src/config/soul-loader.ts`
- `src/gateway/prompt-cache.ts`
- `src/runtime/prompt-manifest.ts` and `src/agents/ollama-client.ts`
- Brain, scheduling, task, team, agent, voice, realtime, boot, and repair modules listed below

Measurements came from current source sizes, the local `.prometheus/prompt-manifests.jsonl` telemetry, and `workspace/Brain/state/activity-package-metrics.jsonl` plus the latest activity-package artifact. Token estimates use the same rough repository convention where possible. The manifest stream is approximately 365 MB, so only bounded tail samples and aggregates were inspected; it was not modified.

## 2. Current-state architecture map

### 2.1 Common main-chat construction

`src/gateway/routes/chat.router.ts:2371` is the main entry point. On a normal turn it:

1. chooses `executionMode` and runtime actor/profile;
2. obtains history unless the mode is cron (`:2590-2592`);
3. auto-activates tool categories from the user message (`:2603-2619`, implemented in `src/gateway/chat/chat-helpers.ts:641-664`);
4. builds working context, recent tool observations, browser state, coding packets, skills, memory retrieval, and caller overlays;
5. builds the personality/runtime context through `src/gateway/prompt-context.ts`;
6. assembles the system message and user/history messages;
7. rebuilds model-specific system material immediately before provider calls (`chat.router.ts:6634-6656`); and
8. records a prompt manifest through `src/runtime/prompt-manifest.ts`.

`src/gateway/prompt-context.ts:37-49` separates stable and volatile material with `PROMPT_CACHE_MARKER`. `src/gateway/prompt-cache.ts:13-36` places the stable prefix before the marker and volatile state after it. This is an important existing cache boundary and should be preserved.

The normal main system assembly is not a single static file. It combines the base/current-model block, dynamic state, the personality block, caller/browser state, active skills, tool menu/category policy, and tool schemas. The exact ordering has separate branches for isolated subagents/team managers/background agents and for other surfaces (`chat.router.ts:4473-4515`).

### 2.2 Runtime personality branches

The authoritative branch logic is `src/gateway/prompt-context.ts:1342-1841`:

| Surface | Current identity/context | Important behavior |
|---|---|---|
| Main interactive | `USER.md`, workspace `SOUL.md`, workspace `MEMORY.md`, optional business context, project/intraday/Brain state, retrieval and tools | Main memory is currently uncapped by `loadFullMemoryProfile`; this is the largest ordinary stable-context component. |
| Main local/teach | Reduced USER/SOUL or local condensed context, with profile-specific tools | Local avoids the full main stack; teach intentionally enables more guidance/browser material. |
| Prometheus-owned cron | Main interactive-style USER/SOUL/MEMORY branch because cron is explicitly not treated as autonomous in the current code (`:1675-1680`, `:1737-1841`) | History, recent observations, and working context are emptied by `chat.router.ts:2590-2628`, but the main personality stack remains. |
| Background task/proposal/heartbeat | Runtime contract plus autonomous SOUL/MEMORY rules; no main USER in the autonomous branch | Mode-specific instructions are added in `chat.router.ts:4330-4385`. Proposal and heartbeat have narrower behavioral permissions. |
| Direct scheduled agent | Runtime actor contract plus canonical `AGENT.md` and private actor MEMORY | Does not receive main USER/SOUL/MEMORY. |
| Background agent | Runtime contract, spawning prompt, private AGENT/MEMORY, and tools (`:1574-1607`) | Isolated from main memory; the source is consistent with the correction at the top of `workspace/self/21-runtime-prompt-map.md`, not with the older matrix below it. |
| Team subagent | Runtime contract, private AGENT/MEMORY, team caller context, and tools (`:1610-1642`) | Main memory is not injected. Categories are reset in `team-dispatch-runtime.ts` to avoid leaking a very large prior tool surface. |
| Team manager | Runtime contract, manager AGENT/private memory, large team caller overlay, and tools (`:1645-1672`) | Correctly distinct identity, but the manager caller, room state, team memory, and private memory may overlap. |
| Voice worker | Voice soul, USER, workspace SOUL, project, bounded BOOT/self guidance, retrieval, and skills (`:1463-1503`) | Current source does not inject workspace MEMORY, config soul, CIS, or intraday state in this branch. This differs from stale self documentation. |
| Realtime voice orientation | Separate `buildSystemPrompt` path, `VOICEAGENT.md`, authority/presence boundary, bounded canonical context, voice memory, and skill digest | `realtime.router.ts:201-253` caches for 60 seconds and clamps canonical context to 10,000 characters. It is orientation/read-only context; the worker owns actions. |

Identity isolation is implemented by `src/gateway/runtime-actor.ts`, `src/agents/subagent-prompt-context.ts`, and `src/agents/agent-prompt-file.ts`. The private-agent builder explicitly states that main USER/SOUL/MEMORY are unavailable. This is a sound boundary and should not be weakened to make prompts superficially uniform.

### 2.3 Prompt sources and injection layers

The active layers are:

- `src/config/prometheus-runtime-contract.md`: shared actor/tool/verification contract, about 1,271 characters;
- `src/config/soul.md`: config-level Prometheus soul, about 8,882 characters;
- workspace `USER.md`, `SOUL.md`, and `MEMORY.md`: approximately 5,351, 4,212, and 30,717 bytes respectively;
- `src/gateway/prompt-context.ts`: memory, intraday, business, tools, skills, identity, runtime actor, and caller assembly;
- `src/gateway/routes/chat.router.ts`: mode policy, browser state, model capability/current-model material, response/style/plan rules, creative/browser/identity/authorization instructions, and tool-result wrappers;
- caller overlays from scheduling, tasks, teams, agents, Brain, boot, repair, and prompt mutation;
- active tool category policy plus serialized tool schemas;
- conversation/history and tool results;
- internal continuation/compaction prompts, which can recursively call `handleChat`.

`src/gateway/prompt-context.ts:1009-1177` also adds an always-available background-agent spawning hint and a large tool menu. `buildToolsContext` is memoized (`:1149-1177`), but the resulting menu/category policy and schemas still contribute materially to every eligible call.

## 3. Construction order and dynamic state

Dynamic state is not limited to the user message. Depending on surface and mode, a turn may receive:

- current date/time and project/workspace state;
- browser active-tab/profile/CDP state (`chat.router.ts:4312-4325`);
- automatically activated categories and their policy blocks;
- matched/recent skills and skill descriptions/resources;
- long-term retrieval results and citations for interactive main calls;
- intraday notes and Brain active context;
- working context, recent tool observations, and coding packets;
- caller/task/team/schedule overlays;
- current model capabilities and current-model selection;
- browser/desktop untrusted-content wrappers and tool-result acknowledgements;
- per-tool goal reminders (`chat.router.ts:8798-8818`, with similar secondary/synthetic loops at `:4214-4229` and `:6319-6339`); and
- synthetic continuation prompts when postchecks detect setup/plan stalling (`:7008-7073`).

The ordinary main route uses stable/volatile assembly, but several caller overlays are rebuilt for each call. Tool results are inherently volatile and can dominate message growth after the first provider call. The manifest records segment hashes and estimated sizes, which makes this measurable without guessing from source alone.

Internal compaction and memory-flush calls (`chat.router.ts:9831-9846` and `:9912-9926`) use compact user prompts but re-enter the normal chat construction path. Their tool filters reduce capability, but their personality/system construction should be reviewed as a separate cost lane rather than assumed to be compact because the user prompt is short.

## 4. Measured prompt and package budget

| Measurement | Current observation | Interpretation |
|---|---:|---|
| Recent real main interactive manifest | ~20,390 system tokens + ~22,344 schema tokens; 52 tools; ~81,560 system characters | Approximately 42,700 estimated system/schema tokens before normal conversation/tool-result growth. |
| Recent aggregate main interactive sample | ~22,345 system + ~23,839 schema tokens | Useful comparative average across a bounded recent manifest sample; not a billing quote. |
| Recent aggregate cron sample | ~26,256 system + ~4,699 schema tokens | Cron has fewer schemas but a larger main-style personality/context block. |
| Main workspace MEMORY | 30,717 bytes | Roughly 7,700 characters/4 tokens before wrapper/formatting; currently uncapped in the main/cron branch. |
| Tool menu without active categories (older verified census) | 12,876 characters | Roughly 3,200-3,500 estimated tokens before full schemas and active policies. |
| Full static private tool surface (older verified census) | 50,287 serialized characters across 34 schemas | Shows why category/schema selection matters even when prose is unchanged. |
| Realtime canonical context | Full alternate builder measured ~27,050 characters; route clamps canonical context to 10,000 | Realtime has explicit bounds, but also adds voice memory, presence/authority, and skill digest. |
| Tool-result goal reminder | 120-character task prefix per result | Ten results can add roughly 300-500 rough tokens once wrappers and formatting are included. |

The older verified measurements are retained as directional evidence because the current manifest is the stronger source for present-day main/cron totals. The manifest's “estimated tokens” fields are implementation estimates and must not be read as exact provider usage.

### 4.1 Six-hour Thought activity package

The current implementation is in `src/gateway/brain/activity-package.ts` and `src/gateway/brain/brain-runner.ts:827-990, 1986-2295`.

The package is built immediately before each Thought model call and passed directly into `_buildThoughtPromptV2`, not merely offered as a search hint. It covers the exact UTC half-open six-hour window and includes provenance, source/store/ref/record/line/timestamp fields, deduplication, redaction, source coverage, omissions, caps, and continuation references. The Thought prompt explicitly forbids reconstructing covered activity through search/list calls and preserves direct continuation references. Those are valuable correctness properties and should remain.

Latest local package evidence:

- compact prompt serialization: approximately 219,995 characters, or roughly 54,999 estimated tokens;
- pretty artifact size: approximately 290,858 bytes;
- inline ledger: approximately 79,049 characters and 84 events;
- continuation ledger: 121 events in a continuation file;
- unresolved work: 200 capped items, approximately 117,128 compact characters;
- source-coverage block: approximately 21,223 compact characters;
- recent package metrics: generally 205-206 events, package estimates around 52,000-55,000 tokens, with one anomalous run around 180,000 estimated tokens;
- package build time: generally about 12-18 seconds in the observed runs, with one longer run.

The six-hour package therefore has two different concerns:

1. semantic authority: the package is intentionally the direct, auditable activity view and should not be replaced by a vague summary without a product decision;
2. prompt budget: the raw unresolved-work payload and full package serialization make a single Thought a budget-scale input before tool-result growth.

Live Brain Thought manifests showed message surfaces growing from approximately 32,600 to approximately 60,000 estimated tokens across tool rounds. This is consistent with the package and fixed Thought rubric being a major input component, although the manifest and package estimates are not identical accounting systems.

## 5. Duplication, stale instructions, and conflicts

### 5.1 Documentation drift that can cause implementation mistakes

`workspace/self/21-runtime-prompt-map.md`, `22-runtime-prompt-verbatim.md`, `23-runtime-context-flow.md`, and `26-runtime-instruction-census.md` contain useful historical evidence, but their correction headers do not remove older contradictory matrices and prose. Current code differs from older sections in at least these ways:

- background agents are isolated from main USER/SOUL/MEMORY in current `prompt-context.ts`, while older matrix/overlap sections say they receive main memory;
- Prometheus-owned cron is intentionally on the main-style branch, while older matrices describe cron as autonomous/no-USER;
- current voice profile context does not inject workspace MEMORY/config soul/CIS/intraday as older voice matrices claim;
- current realtime `soul-loader` behavior explicitly does not inject `TOOLS.md`, and the realtime route uses bounded context rather than the older full-injection description;
- scheduled-agent runtime actor behavior is newer than some execution-mode descriptions in the self notes.

This is a correctness and maintenance risk, not merely a documentation style issue. A future prompt change based on the stale lower sections could reintroduce main-memory leakage or accidentally change cron/voice identity.

### 5.2 Tool-policy duplication

Tool availability and guidance appear in the static menu, category policies, serialized tool descriptions, caller instructions, mode instructions, browser/desktop wrappers, skill guidance, and tool-call-time wrappers. The older census (`workspace/self/26-runtime-instruction-census.md`) correctly identifies this as repeated policy. The current manifest demonstrates the result: tool schemas can exceed 22,000 estimated tokens even when the prose system block is around 20,000.

`autoActivateToolCategories` also silently activates categories from every user message. Stage 4 intent gating narrows some menu sections, but absent caller intents the fallback in `prompt-context.ts:1097-1105` enables all five sections. This is a behavior choice, not a safe mechanical cleanup: stronger gating can reduce cost but can also remove tools the model currently expects to discover.

### 5.3 Repeated small control instructions

- Heartbeat semantics are repeated in the raw `HEARTBEAT.md` payload, the heartbeat user prompt (`heartbeat-runner.ts:462-484`), the caller context (`:528-537`), and the heartbeat mode block (`chat.router.ts:4354-4360`). The exact `HEARTBEAT_OK` rule is therefore authored in multiple layers.
- A goal reminder is appended to every tool result and is also repeated in secondary/synthetic control loops. It is useful for focus, but ten tool results can add hundreds of rough tokens and multiple copies of the same instruction.
- Schedule prompts combine last-run context, completion context, attachments, the job prompt, inter-run messages, schedule memory, and self-reflection (`cron-scheduler.ts:1345-1371`). This is intentional continuity material, but it should have explicit per-component budgets.
- Team managers receive a large caller overlay containing team room state, manager inbox, team memory, team purpose, manager AGENT content, workflow/state contracts, and main-thread context (`team-coordinator.ts:386` onward), in addition to private manager identity/memory and generic runtime/tool guidance. This may be justified, but it is a high-value measurement target.

### 5.4 Heavy prompt paths for analysis-only calls

Several calls need no tools or only a strict JSON result but enter a broad runtime builder:

- pause analysis in `src/gateway/tasks/background-task-runner.ts:767-827` calls `handleChat` with a no-tools filter but `executionMode='interactive'`, so it can still inherit the main personality/memory construction;
- prompt mutation analysis in `src/gateway/scheduling/prompt-mutation.ts:96-187` is a short JSON-only analysis but uses the background-task route and its full autonomous personality/tool surface;
- self-repair analysis in `src/gateway/errors/error-watchdog.ts:294-318` uses a repair-specific caller overlay and background-task mode; it is low frequency but similarly deserves a bounded analyst profile.

These are cost opportunities. Whether they should preserve Prometheus's full voice/style is a product choice, but there is no technical reason for a no-tool JSON analyzer to inherit every interactive guidance layer.

### 5.5 Alternate and legacy prompt paths

There are at least two task prompt families:

- modern `BackgroundTaskRunner` caller/protocol construction (`src/gateway/tasks/background-task-runner.ts`);
- legacy `src/gateway/tasks/task-runner.ts:274-335`, with its own one-action/TASK_COMPLETE/TASK_FAILED protocol, still reachable through task routes.

There are also two broad system prompt builders:

- `src/gateway/prompt-context.ts` for gateway runtime actors;
- `src/config/soul-loader.ts` for realtime/alternate `buildSystemPrompt` consumers.

Both are legitimate for different surfaces, but their contracts and documentation must be explicit. Otherwise “canonical prompt” means different things depending on which route called it.

## 6. Ranked issues

### Rank 1 — P0/P1: direct Thought package can consume the entire useful context budget

Evidence: `activity-package.json` compact serialization around 220k characters; unresolved section around 117k; package metrics around 52k-55k estimated tokens; Thought manifests reaching about 60k message-surface tokens during tool rounds.

Impact: less room for reasoning/tool observations, higher input cost, increased context-limit risk, and more pressure to truncate the very activity history the Thought is intended to inspect.

Recommendation: retain direct package authority, but decide whether unresolved work is allowed to remain as 200 raw records inline. A likely staged design is compact inline summary plus bounded representative rows plus exact continuation/reference files. This requires a product decision about how much unresolved activity must be model-visible without another read.

### Rank 2 — P1: main and cron baseline prompts are large before conversation begins

Evidence: main approximately 20k system plus 22k schemas in a real recent call; cron approximately 26k system plus 4.7k schemas; uncapped workspace MEMORY; large static/tool/caller layers.

Impact: every eligible call pays a large context tax, even when the user request is small. Provider prompt caching can reduce billed repeated-prefix cost where supported, but does not remove context-window pressure or local serialization/transport cost.

Recommendation: establish per-surface budgets and segment-level dashboards first. Then make explicit choices about main memory loading, tool schema exposure, and cron identity.

### Rank 3 — P1: cron continuity and identity semantics are easy to misunderstand

Evidence: `cron-scheduler.ts:368-406` describes prior chat/schedule context and seeds subagent session state, while `chat.router.ts:2590-2628` empties history/observations/working context for `executionMode='cron'`. Prometheus-owned cron intentionally uses the main-style personality branch.

Impact: a scheduled owner may have explicit inter-run context but not the normal history implied by its caller text. The same mode name also covers owner schedules and Brain Thoughts, which have different context needs.

Recommendation: split the conceptual lanes even if implementation remains shared: owner schedule, Brain Thought, and scheduled isolated agent. Whether owner schedules should act with full Prometheus identity or a lean scheduled actor is a product decision.

### Rank 4 — P1: self documentation contains contradictory historical matrices

Evidence: current correction headers are followed by stale tables and prose in `workspace/self/21-26`; current source disagrees on background-agent isolation, cron classification, voice context, and realtime tool/bootstrap context.

Impact: future changes can be based on the wrong prompt contract, especially around memory isolation.

Recommendation: publish one canonical current-state matrix and move historical measurements into explicitly labelled appendices. This is a no-regret maintenance fix once the source-of-truth owner approves the table.

### Rank 5 — P1/P2: tool policy and schema duplication is the dominant ordinary main surface

Evidence: static menu, category policy, schemas, caller rules, wrappers, skill/tool guidance, and current manifests with approximately 22k schema tokens.

Impact: high repeated input, larger selection surface, and more opportunities for conflicting wording.

Recommendation: preserve category selection and cache boundaries, then assign each rule one owner: schema for operation semantics, category policy for routing/permission, caller for task-specific constraints, and result wrapper for untrusted-output handling. Stronger gating or schema summarization requires behavior testing/product approval.

### Rank 6 — P2: no-tool/recovery/repair analyses inherit broad runtime context

Evidence: pause analysis, prompt mutation, and repair analysis use short specialized prompts but broad `handleChat` modes.

Impact: avoidable input and latency on secondary calls; potentially repeated memory/tool/style instructions.

Recommendation: add a dedicated bounded analyst profile after verifying that output tone/format is not a hidden requirement.

### Rank 7 — P2: repeated heartbeat and per-tool goal instructions

Evidence: heartbeat rule appears in four layers; goal reminder appears on every tool result and in retry/control loops.

Impact: modest per-call waste but broad repetition and conflict surface.

Recommendation: canonicalize heartbeat semantics and test reducing the goal reminder to once per model round or a short stable task hash. The latter is low-risk but still deserves focus/regression checks.

### Rank 8 — P2: legacy task and alternate builder paths need an explicit lifecycle

Evidence: legacy `task-runner.ts` remains reachable; `soul-loader.ts` and `prompt-context.ts` both serve as prompt builders with different contracts.

Impact: prompt fixes can land in one path and silently miss another.

Recommendation: inventory reachability, label supported/legacy, and converge only after route-level tests.

### Rank 9 — P2: voice context cache freshness is only indirectly keyed

Evidence: `getVoiceAgentContextBlock` caches for 30 seconds by session/target and uses history length as a freshness signal (`chat.router.ts:11858-11914`), with explicit invalidation paths.

Impact: same-length context changes could theoretically reuse stale context if an invalidation path is missed.

Recommendation: use a content/version hash or stronger invalidation once voice correctness is prioritized. Do not broaden voice context merely to match stale documentation.

### Rank 10 — P2: team manager context is likely high but not yet sufficiently measured

Evidence: team caller state plus manager identity/memory and generic tools are assembled in `team-coordinator.ts:363-383, 386` onward.

Impact: manager calls may carry duplicate team state and high tool/schema cost.

Recommendation: add manager-specific prompt manifests/segment budgets before trimming. Some of this context is operational state, not expendable prose.

## 7. What to cache, summarize, pass by reference, or remove

### Cache or keep stable

- runtime contract, actor identity, static soul/USER material, stable tool descriptions, skill catalog material, and other configuration-backed content;
- the existing stable/volatile boundary and memoized tool context;
- realtime orientation packs within their current TTL and explicit size cap;
- immutable activity-package provenance and continuation references.

Caching reduces repeated serialization/provider cost where supported; it does not make a large prompt semantically free.

### Summarize or bound

- main MEMORY for routes that do not need the entire durable file on every turn;
- unresolved work in the Thought package, subject to an explicit coverage/authority decision;
- team room deltas, schedule inter-run history, and manager inbox with separate budgets per component;
- repeated caller packets and analysis-only context;
- tool policy prose where the schema or category contract is already authoritative.

### Pass by reference

- oversized activity-package continuation ledgers, with exact path/ref and visible omission metadata;
- large workspace/self/source artifacts needed for verification, with focused excerpts and exact paths;
- prior schedule/team artifacts when the task can safely reopen them through an allowed tool;
- long evidence/result artifacts after a compact decision summary is present.

The existing activity package already demonstrates the right reference pattern for overflow. The open decision is how much of the unresolved section must remain inline before using the same pattern.

### Remove or converge after reachability confirmation

- dead snapshot fields `runtimeActorMemory` and `runtimeActorManagerMemory` captured in `prompt-context.ts:1230-1320` but not consumed by the current build paths;
- duplicate heartbeat caller wording after confirming the mode block and raw file are sufficient;
- repeated goal reminders where a round-level reminder preserves focus;
- obsolete compatibility instructions and legacy task prompt text after route reachability is verified;
- stale self documentation that presents historical matrices as current.

## 8. No-regret fixes versus product decisions

### No-regret or near-no-regret engineering work

1. Make the current source-of-truth role matrix explicit and correct the contradictory self-document sections.
2. Preserve and expand prompt manifests with per-segment sizes for main, cron, Brain, team manager, team subagent, voice, and analysis lanes.
3. Add alert thresholds for system tokens, schema tokens, message surface, and Thought package size; include inline/unresolved/continuation component sizes.
4. Keep stable content before `PROMPT_CACHE_MARKER` and ensure dynamic state remains volatile.
5. Add explicit budgets to schedule/team/manager/caller packets and to analysis-only calls.
6. Remove dead captured snapshot fields after a focused regression check.
7. Converge heartbeat wording and reduce duplicated goal reminders after focus/heartbeat tests.
8. Mark legacy prompt paths and add route coverage so future prompt changes cannot silently miss them.

### Decisions requiring product or behavior approval

1. Should Prometheus-owned cron behave as the full owner identity, or as a lean scheduled actor? This changes USER/SOUL/MEMORY/intraday behavior and permissions.
2. How much raw unresolved activity must a six-hour Thought see inline, and what can be summarized or referenced while preserving auditability?
3. Should tool schemas be more aggressively gated or summarized, given that this changes tool discoverability and execution behavior?
4. Is the global proactive background-agent spawning hint part of Prometheus's desired personality, or should it be intent/role gated?
5. Should analysis/recovery/repair calls preserve the full Prometheus personality, or use a compact analyst identity?
6. How much team room/history/manager memory must remain in every manager call?
7. Should per-tool goal reminders remain on every result, or move to round-level/task-state injection?
8. Which legacy task path, if any, remains a supported user-facing contract?

## 9. Staged recommendation

### Stage 0 — establish the contract

- Approve a canonical current-state matrix derived from `prompt-context.ts`, `runtime-actor.ts`, `chat.router.ts`, and the schedule/team/voice routes.
- Label all older self measurements as historical and remove contradictory “current” matrices.
- Define prompt budget units: stable system, volatile system, schemas, user/history, tool results, and package/caller overlays.

### Stage 1 — instrument and contain

- Add segment-level measurements for the caller overlays and Thought package components.
- Set warning thresholds before changing behavior.
- Bound schedule inter-run context, team deltas, manager inbox, and recovery-analysis packets independently.
- Preserve existing stable/volatile/cache boundaries.

### Stage 2 — make the product choices

- Decide cron identity/continuity semantics.
- Decide the inline-versus-reference contract for unresolved Thought activity.
- Decide tool-schema exposure policy and whether the global background-spawn hint remains universal.
- Decide whether analysis-only calls receive a compact analyst profile.

### Stage 3 — consolidate implementation

- Give each instruction one canonical owner and remove duplicates.
- Converge or retire the legacy task prompt path.
- Separate owner schedule, Brain Thought, and scheduled-agent profiles where their context requirements differ.
- Strengthen voice cache versioning and verify realtime/voice documentation against code.

### Stage 4 — verify behavior and cost

- Compare prompt manifests before/after by role and workload, not only by average.
- Run main, cron, Brain, team manager/subagent, voice, heartbeat, recovery, and legacy-task regression scenarios.
- Verify memory isolation explicitly for main, background agent, team agent, manager, and scheduled agent.
- Recheck Thought package coverage/omission semantics and auditability after any compaction/reference change.

## 10. Important non-findings

- The current-model prompt block is not apparently stale at provider-call time: `chat.router.ts:6634-6656` rebuilds it before each call and recent manifests include `model.current`.
- Background-agent main-memory leakage is not present in the current source path; the contradiction is in older self documentation.
- The activity package is not merely redundant search output. Its direct, provenance-rich, omission-visible role is intentional and valuable. The finding is its current size, especially unresolved work, not the existence of the package.
- Realtime voice and the voice worker are separate prompt surfaces with different authority boundaries. They should not be made identical without a product decision.

## Conclusion

Prometheus has a workable layered prompt architecture with strong actor isolation, an existing stable/volatile cache boundary, and unusually useful prompt/package telemetry. The main risks are budget growth and contract drift: large schema/menu layers, uncapped main memory, cron inheriting the main stack while dropping normal history, and the direct Thought package growing to roughly 55k estimated tokens. The safest next move is to finalize the current-state contract and segment-level measurements, then make the two high-impact product decisions—cron identity and Thought inline activity coverage—before changing runtime prompt behavior.
