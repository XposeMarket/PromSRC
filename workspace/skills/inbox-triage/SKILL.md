---
name: "inbox-triage"
description: "Review a connected inbox, prioritize full conversations, and prepare drafts without sending or changing mailbox state unless explicitly directed."
---

# Inbox Triage

Use when the user asks to understand, prioritize, or process a connected inbox. Reading and drafting are distinct from sending or changing mailbox state.

## 1. Define the triage window

Confirm account, folders or labels, time range, priority goals, sender or project filters, and whether the user wants read-only analysis, drafts, or authorized mailbox changes. Never guess which account to operate.

## 2. Gather threads

Search and group by conversation, reading the full thread, including earlier replies and relevant attachments, rather than treating only the latest message as the request. Capture sender, subject, dates, latest state, requested action, deadline, sensitivity, and links. Avoid repeating quoted history. Preserve the original thread identity and do not expose unrelated private content. Check pagination and relevant folders; never claim inbox zero if coverage was incomplete.

## 3. Classify

Sort into: urgent decision, must reply, waiting on someone else, calendar or task commitment, reference, low-priority, newsletter or noise, and possible security or billing concern. Explain the reason for priority and mark uncertainty. Extract owner, action, deadline, and dependency for commitments.

## 4. Prepare next actions

Return a concise priority queue, action table, suggested reply drafts where requested, and a list of questions requiring the user's decision. Before drafting in Raul's voice, sample 20 to 50 of his Sent replies when available and in scope; extract greeting, sign-off, length, and formality rather than copying private text verbatim. Check alternate Sent labels such as `[Gmail]/Sent Mail` before declaring Sent unavailable, then fall back to the thread's register and disclose that fallback. Drafts must not imply facts, attachments, authority, or promises not present in the thread. Draft only unless explicitly told to send. Keep send, delete, archive, label, unsubscribe, and forward as explicit actions requiring confirmation.

## 5. Verify side effects

Before any mailbox write, restate the exact account, recipients, thread, action, and content, then obtain explicit confirmation. After an authorized write, verify the visible result and report it. If sending returns an ambiguous timeout or error, inspect Sent and the thread for the message before any retry to avoid duplicate delivery. If the connector is unavailable, provide a safe browser or pasted-content fallback rather than pretending the inbox was checked.
