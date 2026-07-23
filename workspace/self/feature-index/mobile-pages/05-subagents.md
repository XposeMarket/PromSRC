# Mobile Subagents

Routes: `#mobile/subagents`, `#mobile/subagents/<agentId>`, and `#mobile/subagents/<agentId>/chat`.

The overview lists configured agents with count, model/team/tool/last-run summary and a featured-agent preview. Detail exposes Dispatch Task, Heartbeat Tick and Chat plus these tabs:

- **Overview:** description, effective model, last run, allowed tools, MCP servers, model/voice picker and context references.
- **Chat:** a separate locked chat route to preserve the streaming composer/scroller contract.
- **Memory:** agent-specific memory view.
- **Runs:** agent task history/recovery state.
- **Heartbeat:** agent heartbeat configuration/status.

An agent chat, an agent run and a heartbeat are distinct things. A chat is persistent conversation; a run is executable delegated work; heartbeat is scheduled continuation policy.
