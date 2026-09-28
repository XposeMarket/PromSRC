---
name: "approval-policy-designer"
description: "Design or audit Prometheus approval and confirmation policy for shell commands, source or filesystem changes, browser and desktop final actions, connector writes, publishing, purchasing, deletion, and other high-impact side effects. Use when a task concerns approval classification, hard-deny rules, approval queues, or deterministic confirmation behavior; do not use for ordinary tool execution that is not changing approval policy."
---

# Approval Policy Designer

Use this skill when adding or changing actions that may need user confirmation.

## Current State

Status: strong existing substrate; no high-level policy designer UI/tool yet.

Current support:

- Policy engine: `src/gateway/policy.ts`
- Approval queue: `src/gateway/verification-flow.ts`
- Approval actions: `src/gateway/approval-actions.ts`
- Hard deny: `src/gateway/tool-deny-policy.ts`
- Command permissions: `src/gateway/command-permissions.ts`
- Path permissions: `src/gateway/path-permissions.ts`
- Settings routes for command/path approvals: `src/gateway/routes/settings.router.ts`
- Task approval pauses and the configured messaging channel approval delivery are implemented.

## Procedure

1. Classify action as read, propose, or commit.
2. Identify side-effect type: external message, delete, payment, permission change, filesystem mutation, source edit, browser final action, desktop final action, connector write.
3. Map to existing approval kind:
   - command
   - tool
   - path_access
   - dev_source_edit
   - final_action
4. Keep hard-deny rules separate from allowlists.
5. For one-shot irreversible UI actions, use `request_final_action_approval`.
6. For shell, do not treat approval lite mode as broad trust.

## Gap To Implement

Add a policy designer/inspector that shows why an action is read/propose/commit, what approval it will request, and whether hard-deny blocks it.
