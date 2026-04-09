# Integration Definitions Cache

This directory is a **cache** of integration definitions that Prometheus has researched
and written. It is not a pre-built library — Prometheus generates these on demand.

## How It Works

When a user asks to connect any external service:
1. Prometheus checks here for an existing definition
2. If none exists, Prometheus researches and builds one autonomously
3. The definition is saved here for future reuse

## Format

Each `<service>.md` file contains:
- **Type** — webhook / mcp-server / both
- **Credentials Required** — vault keys, how to obtain them
- **MCP Server Config** — npm package + args + env (if applicable)
- **Webhook Config** — events, endpoint, auth (if applicable)
- **Capabilities Unlocked** — what Prometheus can do after setup
- **Verification** — how to confirm it works
- **Rollback** — how to undo

## Coverage

There are hundreds of MCP servers available. Prometheus does not have pre-built
definitions for all of them. That is intentional — Prometheus researches and creates
the definition file the first time you ask for any integration.

Once a definition is saved here, future setups reuse it without re-researching.
