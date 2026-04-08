# USER.md — About My Human

> Prom builds this file over time.
memory_write to update, - write_note tool to side notes throughout any sessions - 

---

## identity
- Name: Raul
- Platform: Windows 11
- Stack: TypeScript / Node.js
- Version control: Git
- System rebranded from SmallClaw to Prometheus (March 2026)

## accounts
- Google account: Small Claw (Smallclaw.ai@gmail.com), created 2026-03-06

## communication_style
- Prefers direct, less-feral tone in automated posts — no "gremlin" voice

- User is highly sensitive to token/usage cost and prefers very brief responses for pricing/cost questions. [2026-03-18]
- User gives enthusiastic positive feedback (e.g., 'wow... really wonderful') and responds well to polished interactive outputs. [2026-03-18]
- Uses and prefers the assistant name 'Prom' (corrected from 'codex') and gives positive feedback with concise praise. [2026-03-18]
- Proposal quality requirement (March 2026): proposals must be fully concrete and execution-ready; user rejects conceptual/pseudocode wording (e.g., 'conceptual' snippets) and wants absolute, word-for-word specificity. [2026-03-22]
- For desktop-reading tasks, user prefers strict desktop-mode execution: use desktop_screenshot + desktop_click/scroll/focus to read on-screen content directly, and avoid clipboard unless explicitly requested as fallback. [2026-03-22]
- Reconfirmed strongly on 2026-03-27: user wants conversational turns to avoid unnecessary tool calls and gets frustrated when tools are called for casual chat; respond directly unless explicit execution is requested. [2026-03-27]
## projects
- Currently working out post-rebrand kinks after SmallClaw → Prometheus rename


- Active project onboarded: proj_a6d2758b01044d31 — Prometheus Projects testing. [2026-03-22]
## automation_issues
- User reported constraints/bugs: (1) desktop_vision and browser_vision screenshot flows do not return viewable images to the assistant, only metadata; (2) there is no browser-specific send-to-Telegram tool even though browser screenshot exists, only desktop_send_to_telegram path works; (3) Telegram orch post-check is looping repeatedly; user suspects loop is triggered by mandatory skill_list + planning/checklist pre-check behavior in interactive chat. [2026-03-20]


- User reported on 2026-03-27 that they cleared significant token overhead and believe they fixed the issue of Prom calling tools every turn. [2026-03-27]
- Resolved on 2026-03-27: Telegram vision/image analysis now works end-to-end. Assistant can correctly analyze user-sent images and read desktop_screenshot outputs (including terminal text) in-session. [2026-03-27]
## workflow_preferences
- When creating a proposal that involves src code edits, always read SELF.md first. [2026-03-22]
---

*No other categories yet — Prom will add them as it learns more.*

