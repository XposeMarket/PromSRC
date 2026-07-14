---
name: "credential-scope-auditor"
description: "Audit connector manifests, OAuth scopes, setup fields, vault access, and runtime credential handling for least privilege. Use before installing, expanding, or trusting an integration, or when the user requests a credential-scope or connector-security review."
---

# Credential Scope Auditor

Use this skill before installing, expanding, or enabling a connector with credentials.

## Current State

Status: usable manually; needs an automated auditor tool for 110%.

Current support:

- Vault storage: `src/security/vault.ts`
- Extension credential access: `src/extensions/credential-access.ts`
- Manifest setup scopes: `src/extensions/schema.ts` -> `setup.scopes`
- OAuth connectors define scopes in `src/integrations/connectors/*`
- Connections setup routes: `src/gateway/routes/connections.router.ts`
- Log scrubbing: `src/security/log-scrubber.ts`

## Procedure

1. Inspect `prometheus.extension.json` or connector source.
2. List setup fields and mark which are secret.
3. List OAuth/API scopes and classify each as read, write, admin, destructive, or unknown.
4. Compare declared scopes with declared tools.
5. Reject broad scopes when narrower scopes can support the tool set.
6. Confirm all runtime code uses `ctx.getCredential(...)` or connector OAuth helpers.
7. Confirm no token/client secret appears in source, examples, logs, or skill docs.

## Acceptance Check

The connector passes when every credential has a vault path, every scope maps to a tool need, and every side-effecting scope has user-visible confirmation behavior.
