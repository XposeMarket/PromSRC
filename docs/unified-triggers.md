# Unified Prometheus Trigger System

## Product model

Prometheus should expose one automation concept:

> **WHEN** an event happens → **IF** conditions match → **RUN** an existing Prometheus worker → **VERIFY** the outcome → **DELIVER** the result.

The trigger layer is intentionally an event/router layer. It is **not** a second scheduler, task runner, team manager, webhook server, or notification service.

## Existing systems remain authoritative

- `CronScheduler` remains authoritative for clock-based scheduling, schedule memory, output verification, and scheduled-task lifecycle.
- Webhook security remains authoritative for provider signatures, replay protection, payload limits, and untrusted-content boundaries.
- `BackgroundTaskRunner` / agent runtimes remain authoritative for task execution and recovery.
- Managed teams remain authoritative for team dispatch and collaboration.
- Internal watches remain authoritative for observing live task/event/file conditions.
- Existing delivery routing remains authoritative for Telegram/web/mobile/etc.

The unified trigger runtime receives normalized events from those systems and dispatches matched rules back into those existing executors.

## Canonical flow

```text
existing event source
  ↓
TriggerEvent adapter
  ↓
TriggerEngine
  ├─ source / event-type match
  ├─ deterministic field conditions
  ├─ dedupe reservation
  └─ cooldown gate
  ↓
TriggerAction
  ↓
PrometheusTriggerExecutor
  ├─ wake
  ├─ agent
  ├─ task
  ├─ team
  └─ notify
  ↓
existing Prometheus runtime
  ↓
verification + delivery owned by that runtime
```

## Event sources

The contract includes adapters for:

- signed or generic webhooks;
- cron/schedule lifecycle events;
- heartbeats;
- `workspace/events/pending.json` events;
- internal-watch matches/timeouts;
- connector-originated events;
- manual/operator fires.

Adapters bound payload depth, keys, arrays, and string size before they enter the rule engine. Provider/connector payload content remains **untrusted data**.

## Rules

Rules are persisted under the Prometheus config directory at `triggers/rules.json` by default.

A rule contains:

- stable ID and display name;
- enabled flag and priority;
- event-source/event-type/source-ID matcher;
- deterministic field conditions;
- cooldown;
- one action;
- optional verification contract;
- optional delivery contract.

Conditions support only:

- equals / not-equals;
- contains / not-contains;
- exists / not-exists;
- membership (`in`).

There is deliberately **no `eval`, JavaScript expression, shell expression, or user-provided executable condition**.

## Prompt templates

Action prompts support bounded substitutions such as:

```text
Review PR {{payload.number}} titled {{payload.pull_request.title}}.
```

Templates do not support function calls, loops, arbitrary expressions, or executable interpolation.

If an action has no explicit prompt, the executor builds a bounded event packet and labels the payload as untrusted data.

## Dedupe and cooldown

The trigger store keeps a bounded reservation ledger. A rule/event pair is reserved before execution so the same provider delivery or stable event key cannot dispatch twice.

Cooldown is rule-local and independent of event dedupe. This lets a trigger suppress high-frequency distinct events without treating them as duplicates.

The store is intentionally bounded:

- max 1,000 rules;
- max 5,000 recent reservations;
- reservation retention 7 days;
- max 1,000 run-history records.

## Verification and delivery

The Trigger system carries verification and delivery contracts through to the chosen Prometheus executor; it does not independently inspect the filesystem, send Telegram messages, or decide whether a team/task succeeded.

This preserves the verification semantics already implemented by scheduled tasks and the delivery semantics already implemented by Prometheus channels.

## Migration / wiring plan

This PR establishes the canonical runtime and adapters without replacing mature ingress/execution code in one risky change. Wire sources incrementally:

### Phase 1 — provider webhooks

After signature verification and provider replay reservation, construct `webhookTriggerEvent(...)` and dispatch it through the Trigger runtime. Existing provider mappings remain as compatibility fallback until migrated rules exist.

### Phase 2 — schedules

Emit schedule lifecycle events (`due`, `started`, `completed`, `failed`, `paused`) from `CronScheduler`. Clock calculation and the scheduled job itself remain in `CronScheduler`.

This enables rules such as:

- when a research schedule finishes → ask another agent to summarize it;
- when a scheduled job fails → debugging team investigates;
- when a job pauses → notify the user.

### Phase 3 — heartbeat

Emit `tick`, `completed`, and `failed` heartbeat events. Trigger rules can react to heartbeat observations without turning TriggerEngine into the heartbeat scheduler.

### Phase 4 — pending event queue and internal watches

Normalize pending queue entries and watch match/timeout results into TriggerEvents. Existing watch recovery policies remain authoritative.

### Phase 5 — connector events

Connector runtimes can publish normalized connector events with stable provider event IDs where available.

### Phase 6 — UI / model-facing CRUD

Expose rule list/get/create/update/delete and run history through one `trigger_ops`/Automations surface. The UI can render the same data as:

```text
WHEN GitHub pull_request/opened
IF repo = XposeMarket/PromSRC
RUN PR Review Team
VERIFY review result exists
DELIVER only on findings
```

## Example rules

### New PromSRC PR

```json
{
  "version": 1,
  "id": "promsrc-pr-review",
  "name": "PromSRC PR Review",
  "enabled": true,
  "matcher": {
    "sources": ["webhook"],
    "sourceIds": ["github"],
    "eventTypes": ["pull_request"],
    "conditions": [
      { "field": "payload.action", "operator": "equals", "value": "opened" }
    ]
  },
  "action": {
    "kind": "team",
    "targetId": "pr-review-team",
    "prompt": "Review PR {{payload.number}}: {{payload.pull_request.title}}"
  },
  "createdAt": 0,
  "updatedAt": 0
}
```

### Failed schedule

```json
{
  "version": 1,
  "id": "schedule-failure-debug",
  "name": "Investigate failed schedules",
  "enabled": true,
  "matcher": {
    "sources": ["schedule"],
    "eventTypes": ["failed"]
  },
  "action": {
    "kind": "agent",
    "prompt": "Investigate why schedule {{sourceId}} failed and report only actionable findings."
  },
  "createdAt": 0,
  "updatedAt": 0
}
```

## Validation

```bash
npx tsx src/gateway/triggers/trigger-engine.regression.ts
npx tsc --noEmit
npm run test:automations
```

## Non-goals of this slice

- replacing CronScheduler;
- replacing webhook authentication/replay protection;
- implementing arbitrary code conditions;
- silently migrating existing schedules into trigger rules;
- changing task/team execution semantics;
- bypassing Prometheus approvals or tool policy.
