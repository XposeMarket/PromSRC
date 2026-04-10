---
name: Secret and Token Ops
description: >
  Operate safely with credentials, API keys, bearer tokens, and secrets using vault-first handling,
  strict redaction, lifecycle hygiene, and incident-safe leak response procedures. Triggers on:
  secret handling, token management, credential rotation, API key safety, key revocation,
  leaked key response, redact logs, secure storage, vault usage, credential recovery.
emoji: 🔐
version: 1.0.0
triggers: secret handling, token management, credential operations, credential rotation, rotate api key, rotate token, revoke token, revoke key, recover access token, leaked credential, leaked api key, leaked token, incident response for secrets, redact logs, redaction-safe logging, vault-safe credentials, secure secret storage, key lifecycle, token lifecycle, credential hygiene, auth secret safety, env var secret handling, publishable key vs secret key, secret exposure prevention
---

# Secret and Token Ops

Use this skill whenever a task touches secrets, tokens, API keys, credentials, or authentication material.

**Primary goal:** complete the task while minimizing credential exposure risk at every step.

---

## Core Safety Rules (Always On)

1. **Never echo raw secrets in chat output.**
   - Do not print full keys/tokens in responses.
   - Use masked format only (example: `sk_live_****9f2a`).

2. **Prefer vault references over literal values.**
   - Store/retrieve via secure references (e.g., `vault://...`) when available.
   - Avoid copy-pasting secrets into editable files unless explicitly required and justified.

3. **Minimize exposure surface.**
   - Keep secret handling to the smallest number of tools, files, and steps.
   - Avoid temporary plaintext artifacts (scratch files, logs, screenshots) containing credentials.

4. **Redact before logging or reporting.**
   - Treat logs, notes, and status messages as potentially visible to humans.
   - Redact high-entropy strings and known key formats before writing summaries.

5. **Use least privilege + shortest lifetime.**
   - Prefer scoped tokens with minimal permissions.
   - Set expirations/rotation intervals whenever supported.

6. **Do not propagate secrets across channels.**
   - Never send credentials over Telegram/chat/email reports.
   - If sharing is unavoidable, share only secure reference handles and access instructions.

---

## Secure Handling Rules by Phase

### 1) Create

- Generate credentials only when needed for a concrete task.
- Default to:
  - narrow scope/permissions,
  - environment-specific segregation (dev/stage/prod),
  - explicit owner and purpose metadata.
- Record non-sensitive metadata:
  - issuer/system,
  - owner,
  - scope,
  - creation date,
  - planned rotation date.

### 2) Store

- Store secrets in approved secure store/vault first.
- Keep app/runtime references indirect (env var name, vault reference), not inline literals.
- Avoid storing secrets in:
  - git-tracked files,
  - proposal text,
  - daily notes,
  - plain logs.

### 3) Rotate

- Rotation pattern:
  1. Create replacement credential.
  2. Validate replacement in target runtime.
  3. Cut over consumers.
  4. Revoke old credential.
  5. Verify no active usage of old credential remains.
- Use dual-key overlap windows only as long as necessary.
- Update rotation timestamp and next due date.

### 4) Revoke

- Revoke immediately when compromise is suspected or no longer needed.
- Enumerate dependent systems before revocation to reduce outage risk.
- After revoke, run validation checks for:
  - auth failures,
  - fallback behavior,
  - stale cached credentials.

### 5) Recover

- Maintain a recovery runbook per critical credential path.
- Recovery minimums:
  - who can re-issue,
  - where to update references,
  - service restart/reload requirements,
  - rollback fallback if new key fails.
- Confirm post-recovery health and log sanitized timeline.

---

## Redaction-Safe Logging Standard

When writing notes/reports:

- Mask secrets using one of these formats:
  - prefix + last4: `pk_live_****A1B2`
  - generic hash label: `[REDACTED_SECRET_SHA256:abcd1234]`
- Remove full bearer headers (`Authorization: Bearer ...`) from all copied output.
- Replace sensitive URL query values (e.g., `token=...`) with `token=[REDACTED]`.
- Do not include full `.env` content in any output.

**Safe reporting template:**

- Credential Type: API key / token / client secret
- System: `<service>`
- Action: created / rotated / revoked / recovered
- Identifier: masked handle only
- Scope Change: yes/no + short note
- Validation: pass/fail + sanitized evidence

---

## Incident-Safe Leak Response Checklist

Use this immediately if exposure is suspected (chat paste, logs, commit, screenshot, public URL, etc.).

1. **Contain**
   - Pause further sharing/output of the exposed material.
   - Restrict access paths where possible.

2. **Identify**
   - Determine which credential leaked (type/system/scope).
   - Determine exposure channel and time window.

3. **Revoke/Rotate**
   - Revoke exposed credential ASAP.
   - Issue replacement and update dependent services.

4. **Invalidate Sessions/Tokens**
   - Expire active sessions or derived tokens if applicable.

5. **Audit Access**
   - Review logs for suspicious use between exposure and revoke time.

6. **Remediate Artifacts**
   - Remove secret from files, logs, screenshots, and chat history where possible.
   - Replace with redacted placeholders.

7. **Verify Recovery**
   - Confirm services work with new credentials.
   - Confirm old credential no longer works.

8. **Document (Sanitized)**
   - Record incident timeline without raw secrets.
   - Note root cause and prevention actions.

9. **Harden**
   - Add/adjust guardrails: secret scanning, stricter scopes, shorter TTL, better vault policy.

---

## Practical Do / Don’t

### Do

- Use vault references and environment indirection.
- Keep secrets out of chat-visible outputs.
- Rotate on schedule and after personnel/access changes.
- Revoke aggressively when uncertain.
- Leave a sanitized audit trail.

### Don’t

- Paste full tokens into responses, notes, or commit messages.
- Store credentials in repository markdown/config by default.
- Reuse one high-privilege key across multiple services/environments.
- Delay revocation during suspected compromise.

---

## Quick Decision Tree

- **Need to show proof?** Show masked identifier + validation result, never full token.
- **Need persistence?** Store in vault/secret manager, not plain files.
- **Suspected leak?** Revoke/rotate first, investigate second.
- **Not sure if sensitive?** Treat as secret and redact.

---

## End of Secret and Token Ops

Apply this skill by default for any credential-touching workflow to keep operations secure, auditable, and low-risk.
