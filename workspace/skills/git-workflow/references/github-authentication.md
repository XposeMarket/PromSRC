# GitHub authentication and access guardrail

Use this when the user asks Prometheus to authenticate GitHub connector access or expand repository/account access for viewing repositories, creating repositories, committing, or pushing from the local machine.

## Default route

1. Treat this as credential-sensitive setup. Read/apply `secret-and-token-ops` before handling tokens or browser auth.
2. Prefer the configured GitHub connector over pasted tokens. Inspect connector availability and account identity with safe read-only connector tools. If authentication is missing, use the approved integration setup or browser login flow, without viewing or requesting raw credentials. The `gh` CLI is not installed.
3. Ask for explicit approval before any repo creation, push, delete, org permission change, or token-scope expansion.
4. Verify access with safe read-only commands first:
   - GitHub connector read-only repository list or metadata lookup when owner is known
   - `git -C <repo> remote -v` / `git -C <repo> status --short --branch`
5. Report only redacted auth state: username/account if visible and non-sensitive is okay; never print raw tokens, auth headers, or credential-store contents.

## PAT/SSH fallback

- PATs are a fallback, not the default. If used, prefer fine-grained scope and secure credential storage; never paste the raw token into chat or notes.
- SSH keys allow git push/pull but do not by themselves allow repo creation; pair with the GitHub connector for repo administration.
