# Telegram Persona Bots

Prometheus supports one Telegram bot per subagent/persona. The existing main
Telegram bot remains the general Prometheus command channel. Persona bots are
separate bot accounts that route their chats directly into a configured agent.

## Config

Add persona bot accounts under `channels.telegram.personas` in
`.prometheus/config.json`.

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "env:TELEGRAM_MANAGER_BOT_TOKEN",
      "allowedUserIds": [123456789],
      "streamMode": "full",
      "personas": {
        "researcher": {
          "enabled": true,
          "agentId": "researcher",
          "botToken": "env:TELEGRAM_RESEARCHER_BOT_TOKEN",
          "allowedUserIds": [123456789],
          "groupChatIds": [-1001234567890],
          "requireMentionInGroups": true
        },
        "operator": {
          "enabled": true,
          "agentId": "operator",
          "managedBotUserId": 987654321,
          "groupChatIds": [-1001234567890]
        }
      }
    }
  }
}
```

`botToken` is the normal BotFather token for that child bot. If the persona was
created as a Telegram Managed Bot, use `managedBotUserId` instead; Prometheus
will call `getManagedBotToken` through `channels.telegram.botToken`, so that
top-level token must belong to the manager bot.

If a persona omits `allowedUserIds`, it inherits the top-level
`channels.telegram.allowedUserIds`.

## Group Setup

1. Start Prometheus with the persona configured.
2. Open `GET /api/channels/telegram/personas/status` and copy the
   `addToGroupUrl` for each persona, or open `https://t.me/<bot>?startgroup=<accountId>`.
3. Add every persona bot you want into the same Telegram group.
4. In the group, run `/whereami` against each bot.
5. Copy the returned `chatId` into that persona's `groupChatIds`.
6. Restart or save channel config from the API/UI so the manager reloads.

In groups, persona bots only answer when the group is configured. By default,
they also require an `@botusername` mention or a reply to one of their messages,
which keeps several subagent bots from responding to every message at once.

## Team Room Bridge

Persona bots can also turn a Telegram group or forum topic into a Prometheus
team room. This is the bridge that makes Telegram use the same routing rules as
the Web UI team chat: `@team`, `@manager`, and `@agent` messages are routed
through the existing team-room runtime.

Bind a Telegram group or topic to a team:

```text
POST /api/channels/telegram/team-rooms/bind
{
  "chatId": -1001234567890,
  "topicId": 42,
  "teamId": "team_alpha",
  "title": "Alpha Team"
}
```

`topicId` is optional. For two Prometheus teams in one Telegram group, use a
Telegram forum group and bind one topic per team. If you bind only `chatId`, the
whole group maps to that one team.

Important Telegram limitation: bots only receive normal group messages when
privacy mode allows it. For a full team-room bridge where plain `@team` and
`@agent` text is seen by Prometheus, disable privacy mode for the participating
bots in BotFather or address/reply to a bot that can see the message.

Mirrored events:

- user messages from Telegram enter the same team chat path as the Web UI
- manager replies are sent back to the bound Telegram room
- subagent replies are sent via that subagent's persona bot when available
- dispatch start/completion and team change proposals are mirrored back

## Team Setup Assistant

Prometheus can inspect managed teams and generate a bot setup plan for every
team subagent.

1. Make a manager bot in BotFather.
2. Open that bot's BotFather Mini App settings and enable Bot Management Mode.
3. Set `channels.telegram.botToken` to the manager bot token.
4. Start Prometheus and call:

```text
GET /api/channels/telegram/personas/setup-plan
```

The plan includes official managed-bot creation links in this form:

```text
https://t.me/newbot/<manager_bot_username>/<suggested_child_username>?name=<suggested_name>
```

To seed persona config for all current team subagents:

```text
POST /api/channels/telegram/personas/setup-plan/apply
```

After you approve each Telegram creation link, bind the created managed bot to
its persona account:

```text
POST /api/channels/telegram/personas/<accountId>/bind-managed-bot
{
  "managedBotUserId": 987654321,
  "botUsername": "your_child_bot"
}
```

Prometheus then uses the manager token to fetch each child bot token with
`getManagedBotToken` and starts polling the child bot directly.

## Useful Endpoints

- `GET /api/channels/status` includes `telegram.personaBots`.
- `GET /api/channels/telegram/personas/status` returns persona account status
  and add-to-group links.
- `POST /api/channels/telegram/personas/:accountId/test` validates a persona
  token or managed bot ID.
- `GET /api/channels/telegram/team-rooms/status` returns group/topic team-room
  bindings.
- `POST /api/channels/telegram/team-rooms/bind` binds a Telegram group or topic
  to a Prometheus team room.
- `GET /api/channels/telegram/personas/setup-plan` generates managed-bot
  creation links for existing teams.
- `POST /api/channels/telegram/personas/setup-plan/apply` seeds persona config
  for team agents.
- `POST /api/channels/telegram/personas/:accountId/bind-managed-bot` stores the
  created managed bot ID and reloads the persona bot manager.
