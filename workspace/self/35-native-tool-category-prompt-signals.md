# Native tool-category prompt-signal migration

Date: 2026-08-21

## Scope

This pass migrates the native tool categories that benefit most from precise natural-language routing onto the shared `phrases` / `allOf` / `anyOf` / `noneOf` / `minScore` matcher:

- `automation_scheduling`
- `automation_tasks`
- `automation_recovery`
- `automation_sessions`
- `runtime_admin`
- `integration_admin`
- `mcp_server_tools`
- `agents_and_teams`
- `proposal_admin`
- `composite_tools`
- `model_management`

Skills are intentionally out of scope because they already own their prompt-signal metadata and validation path. Connector/provider-specific activation remains owned by the extension activation planner.

## Automation correctness

Natural-language auto-activation now returns only the narrow automation workflow pack. It no longer adds the legacy `automations` umbrella or the old `schedule` / `task` compatibility aliases. The umbrella remains available to explicit legacy callers and `request_tool_category`, but it is not an automatic routing result.

This preserves the token/surface savings of the four-pack split:

- scheduling: schedule CRUD/history/outputs/stuck control
- tasks: task execution/control/watch/dashboard
- recovery: interrupted request/audit recovery
- sessions: Prometheus chat/thread operations

`prometheus_thread_ops` belongs to `automation_sessions`; it is not a runtime-admin tool. `runtime_admin` remains diagnostics and controlled gateway restart.

## Composite review

The composite runtime already executes a saved ordered workflow through the normal tool executor. Fully specified calls therefore perform the underlying tool sequence without an LLM turn between steps. Conditions, retries, timeouts, fallbacks, assertions, saved step state, and `{{steps.<id>...}}` templating are supported. Browser/connector safety remains enforced by the underlying tools rather than bypassed by the composite layer.

The runtime retains a compatibility convenience path that may ask the configured model to infer missing parameters from recent session history. Fully specified composite calls do not use that path. The new regression deliberately supplies all parameters and verifies deterministic multi-step execution and prior-step state reuse with a browser-style X posting workflow.

## Regression contract

The new prompt-signal regression asserts exact category sets for migrated categories rather than only checking that an expected category is somewhere in the result. This specifically prevents narrow automation routing from silently reintroducing the broad automation umbrella.

The PR workflow also runs the deterministic composite workflow regression.
