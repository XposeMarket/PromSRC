# GitHub Token / CLI Auth Safety Note — 2026-05-16

Use this when a GitHub setup workflow touches Personal Access Tokens, GitHub CLI auth, SSH keys, repo permissions, or credential-manager state.

## Rules

- Prefer browser-based `gh auth login` over chat-pasted PATs.
- If a PAT is unavoidable, use a fine-grained token with the narrowest repo/org scopes needed and a short expiration where possible.
- Never print raw tokens, bearer headers, credential-store output, or full secret values in chat, notes, proposals, or artifacts.
- Verify auth with `gh auth status` and repo-list/read checks; report sanitized account/scope state only.
- Repo creation, delete, push, workflow edits, and org permission changes are external side effects; require explicit user approval or an approved proposal/action lane.
- If `delete_repo`, `workflow`, org admin, or webhook permissions are requested, pause and explain why the scope is high-risk before proceeding.

## Evidence

the user asked for full GitHub access for the organization operations on 2026-05-16, including repo viewing, commits/pushes, and creating repos. Prometheus recommended GitHub CLI auth and warned against pasting tokens directly into chat. Source: `audit/chats/transcripts/telegram_1799053599_1778917781793.md:73-111`.
