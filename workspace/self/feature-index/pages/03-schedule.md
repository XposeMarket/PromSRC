# Schedule Page: Recurring and One-Shot Jobs

Owner: `web-ui/src/pages/SchedulePage.js`; routes are primarily in `teams.router.ts` plus task/schedule services.

The Schedule page manages persistent jobs, not a simple reminder list. A job may be recurring or one-shot and may be owned by Prometheus, a configured subagent, or a managed team. Its future run receives its saved instruction/context/skill attachments rather than relying on the current chat’s transient text.

## What the page exposes

- List, create, edit, enable/pause, delete, and manually run schedules.
- Natural-language schedule parsing alongside structured cron/run-at/friendly recurrence fields.
- Owner, timezone, model override, delivery channel, team/subagent assignment, attached skills and context-reference cards.
- Per-job run state, recent result/log, schedule memory and context-reference management.
- Brain Thought/Dream status/config/manual run controls present in the same operational scheduling area.

## Lifecycle

Creating/updating a schedule saves the future instruction and timing configuration. `run now` triggers a job immediately but does not convert a recurring job into a normal chat. Pause stops future scheduled execution; it does not erase history. A team-owned schedule wakes the team manager, which derives and dispatches the member work. Heartbeat is a separate per-agent continuation mechanism and should not be documented as an ordinary schedule.

## Source-backed boundaries

Schedules can have delivery and model settings, but actual channel/provider availability still depends on configuration. Legacy heartbeat schedules have compatibility restrictions; use the dedicated Heartbeat setting/API for heartbeat behavior.
