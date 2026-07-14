# xurl / X OAuth Client Secret Setup Guardrail — 2026-05-22

Use this note when setting up X/xurl, X Developer OAuth apps, or any CLI/browser OAuth flow that needs a Client ID, Client Secret, callback URL, or browser login.

## Observed workflow

- `@xdevplatform/xurl` setup can be completed locally even when global install fails, but authentication still requires an X Developer OAuth app registration.
- xurl expects an app entry such as `xurl auth apps add <name> --client-id ... --client-secret ...`, then browser OAuth and a default account selection.
- Prometheus may have an xAI/Grok connector connected while the X connector is still not connected; do not treat those as equivalent.

## Guardrail

1. Fetch/read the official setup page first and identify only the needed setup sections.
2. Do not ask the user to paste raw Client Secrets into chat.
3. Prefer a browser/terminal flow where the user enters the Client Secret directly into the local prompt, or use an approved vault/secret reference if available.
4. Keep redirect/callback URI, app name, scopes, and non-secret setup metadata visible in chat; redact Client Secret and OAuth tokens in all reports/notes.
5. After auth, verify with sanitized CLI status only (for example account handle/app name/success state), never by printing stored credential files.
6. If a connector exists for a related but different product (for example xAI vs X), explicitly separate connector state from the OAuth app required by the CLI.

## Evidence

- `audit/chats/transcripts/0889e2b9-113c-4497-b391-995151368583.md:53-110` — xurl setup reached local CLI success but stopped before auth because X Developer Client ID/Secret were needed.
- `Brain/skill-episodes/2026-05-22/episodes.jsonl:3` — secret-and-token-ops was used during the xurl setup run, with blockers around shell policy and OAuth app registration.
