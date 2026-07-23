# Subagents Page: Persistent Individual Agents

Owner: `web-ui/src/pages/SubagentsPage.js`; gateway: `channels.router.ts` agent routes.

Subagents are named, persistent agents with their own configuration, chats, workspaces, task runs, memory/instruction files, model settings, skills, context references, heartbeat behavior and optional team membership. They are not the same thing as one-off background workers.

## What the page exposes

- Agent inventory; create/update/delete; profile-pack preview/install.
- Identity and operational files (agent instructions, memory, heartbeat/config) plus workspace notes/attachments/context files.
- Allowed tools, MCP servers, skills, model/default route, voice configuration and schedule/next-run information.
- Persistent direct chat with a specific agent and live stream replay.
- Runs/history with task detail and recovery interfaces for eligible paused/stalled/failed work.
- Heartbeat configuration and manual tick controls.

## Important lifecycle rule

An agent’s completed task run is immutable historical work. A new milestone is delegated as a new task; it is not silently “continued” by modifying the completed run. Recovery chat is for recoverable unfinished/failed states. Normal ongoing conversation uses the agent chat lane, not an execution-task recovery route.
