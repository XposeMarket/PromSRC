# 29) Agent Identity and Memory Runtime

Verified 2026-07-13 against the active `C:\Users\rafel\PromSRC` working tree.

This document records the implemented identity contract. It supersedes older statements in documents 08, 13, and 21–26 that say team members inherit a subagent soul, managers use main Prometheus personality, or team dispatch callers tell members they are Prometheus.

## Canonical rule

Prometheus is the platform and Prom is the primary user-facing agent. Managers and named agents operate inside Prometheus, but they are not Prom and do not impersonate the main chat.

Capability posture is shared through `src/config/prometheus-runtime-contract.md`. Identity is role-owned through the runtime actor contract and each named actor's `AGENT.md`. Durable personal memory belongs to that actor's `MEMORY.md`.

## Runtime roles

| Role | Identity | Personal memory | Shared context | Explicitly excluded |
|---|---|---|---|---|
| Main Prom | Main base identity + config/workspace soul | Main USER/SOUL/MEMORY and indexed history | Project/business/tool state when applicable | Agent-private memory |
| Manager | Dedicated manager AgentDefinition + manager AGENT.md | Manager MEMORY.md | Bounded team memory snapshots and manager caller context | Main USER/SOUL/MEMORY |
| Standalone agent | AgentDefinition + AGENT.md | Agent MEMORY.md | Current assignment and allowed work roots | Main USER/SOUL/MEMORY; team memory unless on a team |
| Team agent | Team-scoped AGENT.md copy | Team-scoped agent MEMORY.md | Bounded team info/memory/last-run/pending snapshots | Main USER/SOUL/MEMORY; another team's identity or memory |
| Ephemeral worker | Temporary worker role contract | None by default | Current task only | Persistent named identity |
| Voice | Existing Prom voice identity | Existing voice continuity paths | Voice-specific runtime pack | No behavior change in this migration |

## Injection points

- `src/gateway/runtime-actor.ts` owns actor kind, surface, identity root, execution root, private memory root, and canonical role wording.
- `src/gateway/prompt-context.ts` injects the shared runtime contract and private actor memory on direct, background, team, manager, scheduled-agent, and agent model-switch paths.
- `src/gateway/routes/chat.router.ts` uses actor-aware identity and prevents team managers from receiving main-agent team-routing personality.
- Direct chat, room chat, dispatch, scheduled runs, and background runs register the actor before prompt assembly.
- `src/agents/reactor.ts` uses the same runtime contract + AGENT.md + private MEMORY.md model.

## Memory boundaries

- `memory_read` and `memory_write` with `file="memory"` resolve to the current named actor's MEMORY.md.
- Named agents and managers cannot use those tools to read or write main USER.md or SOUL.md.
- `write_note` resolves to actor-private notes for named agents/managers rather than the main intraday note.
- Team shared truth remains in the team workspace memory system. Manager private memory is not a replacement for shared team memory.
- Team identity creation copies an initial MEMORY.md once, then each team-scoped identity evolves independently. It refuses to copy a team-private identity into a different team.
- Shared team caller snapshots are bounded to prevent unbounded prompt growth.

## Manager lifecycle

Managed teams now own `managerAgentId`. Existing teams without one are migrated lazily to `<teamId>_manager`. The manager is registered as a real AgentDefinition, has a manager workspace with AGENT.md and MEMORY.md, and uses its configured model/provider route for coordination and review turns.

Legacy `manager.systemPrompt` and `managerNotes` seed the new files when they exist; they remain compatibility inputs, not the canonical runtime identity store.

## Legacy compatibility

`src/config/subagent-soul.md` is retained as a rollback fallback only. Active agent prompt paths use `prometheus-runtime-contract.md`; the old soul is not normally injected. Both files are copied into `dist/config` so compiled/public packages are deterministic and rollback-capable.

Stored chat history and historical documents may still contain old `You are Prometheus` team prompts. They are evidence of past runs, not active prompt sources. Main-only Brain, voice, provider fallback, and helper prompts may correctly use Prometheus identity and must be evaluated by their recipient before removal.

## Verification

- `npm run build:backend`
- `node scripts/test-agent-identity-memory.mjs`
- `node scripts/test-subagent-context-isolation.mjs`
- `npm run test:runtime-prompt-manifest`
- `npm run test:instruction-segment-resolver`

The identity-memory regression proves that agent writes land in the agent file, main MEMORY.md remains untouched, USER/SOUL access is rejected, manager wording is distinct, and legacy team caller wording is absent. The context test proves subagent branches exclude main memory and that model switching cannot reintroduce it.
