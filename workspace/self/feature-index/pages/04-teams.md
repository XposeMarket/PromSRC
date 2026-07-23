# Teams Page: Managed Multi-Agent Workspaces

Owner: `web-ui/src/pages/TeamsPage.js`; gateway: `teams.router.ts`.

Teams are persistent managed groups, not a visual grouping of arbitrary chats. A team has a purpose/context, manager, members, model/review settings, runs/events, workspace/context sources, and a collaboration/chat channel.

## Page areas and actions

- Team inventory and create/update/delete configuration: name, description, purpose, manager prompt/model, member composition and review trigger.
- Start, pause/resume, run-all, targeted dispatch and explicit manager-review controls.
- Team chat with streamed messages/events; manager/member coordination is visible without collapsing it into the main user chat.
- Runs and event feeds show completed/in-progress coordination history.
- Context references and uploaded context files are managed separately and injected into the applicable manager/member runtime.
- Team workspace lists/read/writes/deletes scoped files; it is not the owner’s full workspace.
- Proposed changes have explicit apply/reject controls.

## Runtime relationship

A team schedule or start action wakes the manager; the manager interprets current purpose/memory/context and dispatches members. The Team page exposes that hierarchy and its results. It does not mean all agents continuously run, and pause/resume affects the managed team lifecycle rather than overwriting individual historical task output.
