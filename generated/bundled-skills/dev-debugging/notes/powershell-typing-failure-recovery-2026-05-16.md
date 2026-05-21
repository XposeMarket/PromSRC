# Codex handoff recovery: PowerShell typing/clipboard failure (2026-05-16)

## Evidence
During a Codex desktop handoff in `audit/chats/transcripts/telegram_1799053599_1778944842333.md:99-116`, Prometheus focused Codex and pressed `Ctrl+N`, but `desktop_type`, `desktop_set_clipboard`, and `desktop_type_raw` all failed through PowerShell while trying to send a long prompt containing nested quotes, backticks, parentheses, and multi-line source evidence. The matching skill episode is `Brain/skill-episodes/2026-05-16/episodes.jsonl:3`.

## Recovery guardrail
If the default `Ctrl+N → desktop_type → Enter` path fails because PowerShell/SendKeys/clipboard cannot handle the prompt text:

1. Do **not** keep retrying the same long quoted prompt.
2. Compress the Codex prompt to a short, plain-text version with no markdown fences, no backticks, and minimal punctuation.
3. Prefer one small paste/type attempt over several large attempts. If the typing tool supports chunking in the current runtime, send short chunks line by line.
4. If typing and clipboard both fail after simplification, capture a Codex screenshot and report the exact desktop-tool blocker instead of silently abandoning the handoff.
5. Preserve the deeper evidence in the chat response or note, but keep the text sent into Codex simple enough for Windows input automation.

## Minimal prompt shape after simplification

```text
Hi Codex, it's Prometheus on behalf of Raul.
Please verify two Prometheus dev issues and fix if small and safe:
1. Scheduled runs may lose write_note after tool filtering.
2. Source edit proposal validation may falsely reject source-read evidence.
Relevant files to inspect: chat.router.ts, cron-scheduler.ts, self-reflection.ts, server-v2.ts, proposal store/validator files.
Please report what you find and any fix applied.
```
