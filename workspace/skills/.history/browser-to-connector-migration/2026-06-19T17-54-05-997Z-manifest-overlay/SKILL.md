---
name: browser-to-connector-migration
description: Use this skill when a repeated Prometheus browser automation workflow should be evaluated for migration into a connector, teach workflow, composite tool, desktop macro, API integration, or durable automation. Triggers on phrases like browser workflow got brittle, make this a connector, browser to connector, repeated browser task, automate this site better, teach workflow, composite tool candidate, API migration, and stop using browser for this. Use it to decide whether to preserve browser automation or replace it with a safer typed integration.
emoji: "🔁"
version: 1.1.0
triggers: browser workflow got brittle, make this a connector, browser to connector, repeated browser task, automate this site better, teach workflow, composite tool candidate, API migration, stop using browser for this, connector migration, browser automation replacement
---


# Browser-to-Connector Migration

Use this skill when a browser workflow has become repetitive or brittle.

## Current State

Status: usable as a decision workflow; API migration still needs connector implementation.

Current support:

- Browser teach mode exists.
- Teach verification: `browser_teach_verify`
- Browser teach state snapshots are saved by `saveBrowserTeachSessionSnapshot(...)`.
- Chat prompt has `[TEACH_SESSION]` behavior.
- Brain can propose browser teaching workflows from repeated manual workflows.
- Connector substrate exists through extensions and `connector-builder`.

## Decision Tree

- Stable public API exists -> build connector.
- No API but stable browser flow -> browser teach workflow.
- Local desktop app -> desktop workflow.
- Pure sequence of existing tools -> composite.
- One-off workflow -> do not formalize yet.

## Procedure

1. Inspect recent tool observations for repeated browser steps and failures.
2. Check whether a supported API exists.
3. If API exists, use `connector-builder` and create typed tools.
4. If API does not exist, keep/verify a teach workflow.
5. Preserve final submits/posts/payments/deletes behind `request_final_action_approval`.

## Gap To Implement

Add a migration report tool that reads teach sessions/tool observations and outputs a connector-vs-teach recommendation.
