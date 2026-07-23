# Hub: Operational Overview, Usage, and Brain Activity

Owner: `web-ui/src/pages/HubPage.js`.

Hub is the summary/observability page. It is not another chat thread or a general settings screen. It assembles high-level operational cards from gateway-backed endpoints so an operator can see what Prometheus has been using and what its improvement systems are surfacing.

## Current sections

| Section | Backing concept |
|---|---|
| Goals | Hub goal data; a summary of current/recent operational objectives rather than an editable project plan replacement |
| Models/usage | Provider/model overview and usage-limit state for the selected time range |
| Skills | Skill usage, review candidates and skill-review actions; evidence-backed maintenance, not automatic arbitrary rewrites |
| Token activity | Recent token/activity metrics |
| Tool overview/heatmap | Tool activity over a chosen range/month; an observability view, not a permissions screen |
| Brain activity | Thought/Dream/pulse-card suggestions and recent self-improvement signals where the Brain runner is configured |

Hub is the right place to explain “what the system has been doing and what it is learning from,” while Tasks/Teams/Subagents remain the right places to operate a specific run or agent.
