# Subscription-gated OAuth/API access investigations

Observed: 2026-05-15 during a Grok/xAI + Hermes Agent access investigation request.

## Failure signature

- The user is testing a provider feature that appears gated by subscription tier or account entitlement.
- Errors mention inactive subscription, insufficient permissions, invalid key, quota, or caller not authorized.
- The workflow involves OAuth tokens, API keys, model/provider routing, or attempts to compare browser/app behavior against direct API calls.

## Guardrail

Treat this as a credential/auth investigation first, not a normal web research or coding task.

1. Read this skill before handling the request.
2. Redact all keys/tokens/account identifiers in chat, notes, and reports.
3. Distinguish these cases explicitly:
   - bad/missing API key
   - exhausted quota/resources
   - subscription/entitlement mismatch
   - provider-side product gate
   - implementation bug in Prometheus routing
4. Prefer source/docs and local code inspection over guessing from error text.
5. Do not paste raw OAuth payloads, bearer headers, cookies, or full API responses containing credentials into durable files.
6. If the user asks for a workaround, keep the investigation bounded to legitimate configuration, entitlement, OAuth flow, and product-surface differences; do not create broad bypass instructions or credential-exfiltration patterns.

## Evidence

- `audit/chats/transcripts/telegram_1799053599_1778887762276.md:10-18`
- `audit/chats/transcripts/990a0c12-6a43-4d10-a91d-f51a0304f845.md:1-18`
- `audit/chats/transcripts/telegram_1799053599_1778887724182.md:4-9`
