# GitHub CLI Full-Access Setup Guardrail — 2026-05-16

Use this when Raul asks Prometheus to get full GitHub access for Xpose Market or another repo/account: view repos, create repos, commit, and push from the local machine.

## Default route

1. Treat this as credential-sensitive setup. Read/apply `secret-and-token-ops` before handling tokens or browser auth.
2. Prefer local GitHub CLI auth over pasted tokens:
   - Verify `gh` availability.
   - Use `gh auth status` to inspect current auth without printing tokens.
   - If not authenticated, guide/trigger `gh auth login` using browser-based auth when an interactive shell/desktop flow is approved.
3. Ask for explicit approval before any repo creation, push, delete, org permission change, or token-scope expansion.
4. Verify access with safe read-only commands first:
   - `gh auth status`
   - `gh repo list <owner> --limit 10` when owner is known
   - `git -C <repo> remote -v` / `git -C <repo> status --short --branch`
5. For Xpose Market submodule/repo work, remember the Prometheus workspace submodule path is `workspace/xposemarket-site`, not plain `xposemarket-site`.
6. Report only redacted auth state: username/account if visible and non-sensitive is okay; never print raw tokens, auth headers, or credential-store contents.

## PAT/SSH fallback

- PATs are a fallback, not the default. If used, prefer fine-grained scope and `gh auth login --with-token` or secure credential storage; never paste the raw token into chat or notes.
- SSH keys allow git push/pull but do not by themselves allow repo creation; pair with `gh` for repo administration.

## Evidence

Raul asked on 2026-05-16 for Prometheus to have full GitHub access outside the Connections panel for Xpose Market work, including repo viewing, commits/pushes, and repo creation, then asked Prometheus to set it up. Source: `audit/chats/transcripts/telegram_1799053599_1778917781793.md:12-114`.