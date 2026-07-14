---
name: "discord-connector"
description: "Build or extend a Discord bot or OAuth connector with typed server, channel, thread, message, member, and moderation tools. Use when implementing or hardening Discord integration in Prometheus; do not invoke for generic social-media work."
---

# Discord Connector

Use this skill when Prometheus needs Discord access for communities, support servers, team rooms, announcements, or message research.

## Prometheus Fit

Build Discord as a connector with typed tools and bot/OAuth credentials. Do not rely on desktop/browser automation except for one-time setup guidance.

## Tool Scope

Start with:

- `discord_list_guilds`
- `discord_list_channels`
- `discord_search_messages`
- `discord_read_channel`
- `discord_read_thread`
- `discord_send_message`
- `discord_create_thread`
- `discord_add_reaction`
- `discord_upload_file`

## Rules

- Sending messages, creating threads, uploading files, reactions, moderation actions, and DMs require explicit confirmation.
- Respect Discord permission boundaries returned by the API.
- Store bot tokens only through Prometheus credentials/vault.
- Never log full bot tokens, webhook URLs, or invite secrets.
- For large channels, paginate and return message cursors.
- Preserve Discord message IDs, channel IDs, guild IDs, author IDs, and jump URLs.
- Add rate-limit handling; Discord APIs must back off instead of retry-spamming.

## Implementation Route

1. Use `connector-builder` for a data-dir REST connector.
2. Prefer bot-token flow for server operations; OAuth user flows should be separate and clearly scoped.
3. Add read-only tools before write tools.
4. Add confirmation wrappers for all side effects.
5. Add dry-run formatting for outgoing messages.

## Acceptance Check

Prometheus can search/read Discord context and prepare outbound messages while making every public side effect visible before execution.
