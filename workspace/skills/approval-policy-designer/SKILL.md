---
name: approval-policy-designer
description: Use this skill when designing, auditing, or changing Prometheus approval and confirmation gates for shell commands, filesystem mutation, source edits, browser final actions, desktop final actions, connector writes, deletes, payments, publishing, permission changes, or other risky side effects. Triggers on phrases like approval policy, confirmation gate, final action approval, command permissions, path permissions, tool deny policy, approval queue, require user confirmation, and policy engine. Use it to map risk classes to deterministic Prometheus approval behavior.
emoji: "🛡️"
version: 1.1.0
triggers: approval policy, confirmation gate, final action approval, command permissions, path permissions, tool deny policy, approval queue, require user confirmation, policy engine, browser final action, desktop final action, connector write approval
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
- Task approval pauses and Telegram approval delivery are implemented.

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
