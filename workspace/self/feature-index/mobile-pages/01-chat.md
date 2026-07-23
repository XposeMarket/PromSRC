# Mobile Chat

Route: `#mobile/chat[/<session>]`. Mobile Chat is a paired gateway client, not an isolated conversation store. The session drawer groups/searches server sessions, creates a fresh `mobile_default` session when requested, and opens a selected main-chat session as the voice/chat target.

The screen renders typed messages, attachments, stream events, tool/progress state, generated media/files, the main-goal pill, pending approvals, and background-spawn lanes. It preserves recovery data for interrupted streams: server chat stream replay, run/reconciliation endpoints, and client dedupe prevent an interrupted mobile connection from being treated as a new unrelated task.

The composer can send typed text, uploaded media, or staged camera/voice inputs. Stop controls target the active run rather than deleting history. If a voice interaction hands work to the Worker, the same current chat becomes the Worker’s durable foreground thread.
