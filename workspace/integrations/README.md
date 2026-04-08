# Integration Definitions Cache

This directory is a **cache** of integration definitions that SmallClaw has researched
and written. It is not a pre-built library — SmallClaw generates these on demand.

## How It Works

When a user asks to connect any external service:
1. SmallClaw checks here for an existing definition
2. If none exists, SmallClaw researches and builds one autonomously
3. The definition is saved here for future reuse

## Format

Each `<service>.md` file contains:
- **Type** — webhook / mcp-server / both
- **Credentials Required** — vault keys, how to obtain them
- **MCP Server Config** — npm package + args + env (if applicable)
- **Webhook Config** — events, endpoint, auth (if applicable)
- **Capabilities Unlocked** — what SmallClaw can do after setup
- **Verification** — how to confirm it works
- **Rollback** — how to undo

## Coverage

There are hundreds of MCP servers available. SmallClaw does not have pre-built
definitions for all of them. That is intentional — SmallClaw researches and creates
the definition file the first time you ask for any integration.

Once a definition is saved here, future setups reuse it without re-researching.
