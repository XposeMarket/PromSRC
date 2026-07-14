---
name: "secret-and-token-ops"
description: "Handle secrets, tokens, API keys, credentials, OAuth material, rotation, revocation, leak response, and authentication evidence safely. Use whenever a task touches credential material."
---

# Secret and Token Operations

Minimize credential exposure while completing the requested operation.

## Always

- Never echo raw secrets in chat, logs, screenshots, notes, proposals, commands, or reports.
- Prefer vault references or environment indirection to literal values.
- Use least privilege, the shortest practical lifetime, and environment-specific credentials.
- Mask evidence with a non-secret identifier such as prefix plus last four characters or a one-way fingerprint.
- Redact bearer headers, sensitive URL parameters, `.env` contents, and high-entropy values before persistence.
- Keep secret handling inside the smallest possible tool/file scope; do not propagate credentials across chat, email, or messaging channels.

## Lifecycle

For creation, record only non-sensitive owner, purpose, scope, issuer, environment, and rotation metadata. For rotation: create replacement, validate it, cut consumers over, revoke the old credential, then verify the old credential fails. On suspected exposure: contain sharing, identify scope, revoke or rotate first, invalidate derived sessions, audit use, sanitize artifacts, verify recovery, and record a redacted incident timeline.

Never commit credentials, place them in skill resources, or include them in diagnostic packets. If the required secure store or authorization is unavailable, fail closed and explain the exact setup needed.

Read [the detailed guide](references/detailed-guide.md) for phase-by-phase handling, redaction formats, recovery, and incident checklists. Load provider-specific background references only when that provider and operation match the task.
