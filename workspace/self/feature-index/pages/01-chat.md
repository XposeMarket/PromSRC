# Chat Page: Foreground Worker Workspace

Owner: `web-ui/src/pages/ChatPage.js`; gateway: `chat.router.ts`.

Chat is the foreground Prometheus Worker workspace. It owns normal session history, the active prompt, streamed text/reasoning/tool state, inline approvals, main goal/progress, attachments, generated artifacts, and right-panel workspaces. It does not turn every result into a background task: the foreground Worker runs here until a request is delegated to a background/agent/team lane.

## Major surfaces

- **Session/sidebar:** session/channel selection, creation, search, pinned/recent state, project links and channel-origin labels. Server sessions/history are authoritative; local storage only accelerates client restoration.
- **Conversation:** streamed user/assistant turns, edit-and-rerun, variants, tool traces, errors, artifacts, images/files and attachment pills.
- **Goal/progress:** the main goal strip/checklist is current session work state. It is not a universal task board.
- **Approvals/questions:** pending command/source/final-action approvals and user questions are rendered in the originating chat; resolving them calls the relevant gateway approval/question route.
- **Right panel:** switches among file/canvas projects, browser canvas, creative workspace and previews. Its state is tied to the active chat where applicable.
- **Side chat:** creates a deliberately bounded branch. It may copy selected parent/project context, but it does not inherit active parent tools, approvals, edits or plans unless the user asks within the side chat.

## Browser and creative inside Chat

The browser canvas follows the current browser session and supports agent, copilot and teach modes. Teach capture/verification is a separate approved workflow, not an automatic skill/composite creator. The Creative workspace uses project/scene/composition gateway routes and shows render/asset/timeline state; complete Creative capabilities are in `../05-creative-studio.md`.

## Voice relationship

Chat is where Worker-handoff voice requests arrive. The Voice Agent may be live on mobile, but complex spoken work becomes a regular foreground Worker turn here so it receives the full plan/tool/approval model. See `../16-voice-agent-and-worker.md`.
