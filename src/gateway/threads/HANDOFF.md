# Peer thread handoff contract

Peer threads do not inherit the sender conversation. Supply a self-contained prompt containing the user request, agreed plan, decisions, observed evidence and exact errors, hypotheses clearly labeled, workspace/source paths, constraints and authorization boundaries, and completion checks. Do not copy credentials or unrelated history.

`prompt` is the full assignment. `objective` is a supervisor summary, never a replacement for the assignment. Creation delivers both distinct values and explicit `acceptance_criteria` to the worker. `create_many` uses this same creation path for every item and exposes per-item acceptance criteria. Objective-only calls and blank idle thread creation remain supported. Supervised work retains a single `/goal` prefix.

Send/steer follow-ups must include newly relevant context; they do not automatically copy sender history. This patch does not enforce semantic completeness or retroactively repair already queued assignments.

Regression: `npm run test:thread-handoff`. Also run the thread model-route and settled regressions and `npm run build:backend`.
