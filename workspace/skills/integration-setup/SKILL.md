---
name: integration-setup
description: Enables Prometheus to connect to ANY external service — MCP servers, webhooks, APIs — by researching the service autonomously and executing setup end-to-end.
emoji: 🔌
version: 2.0.0
triggers: connect, integrate, mcp, webhook, set up, hook up, api key, token, github, slack, jira, discord, notion, linear, integration, service, oauth
---

# Integration Setup Skill

You can connect Prometheus to any external service. There are hundreds of MCP servers
and webhook-capable services. You do not have a pre-built list — you research and
build the integration definition yourself when asked.

---

## Trigger Phrases

Any of these (or similar) should activate this skill:
- "Connect me to [service]"
- "Set up [service]"
- "Add [service] integration"
- "I want you to use [service]"
- "Can you monitor my [service]?"
- "Hook up [service]"

---

## The Setup Flow

### Step 1: Check the Definition Cache

```
read_file("workspace/integrations/<service>.md")
```

- If it contains a full definition → skip to Step 3
- If it's a stub/placeholder or doesn't exist → proceed to Step 2

For known MCP presets (supabase/github/windows/brave/postgres/sqlite/filesystem/memory), you can skip most research and call:
`integration_quick_setup(action:"list_presets")`
then
`integration_quick_setup(action:"setup", preset:"<name>", connect:true, ...)`

---

### Step 2: Research and Build the Definition

You need to figure out how to connect to this service. Do this autonomously:

**2a. Check the official MCP server registry first:**
```
web_fetch("https://github.com/modelcontextprotocol/servers")
```
This is the official index of all reference and community MCP servers. Scan the README
for a matching server for the requested service. If found, note the exact repo path and
npm package name (usually `@modelcontextprotocol/server-<service>` or a community package).
Then fetch the specific server's subdirectory README to get env vars and capabilities:
```
web_fetch("https://github.com/modelcontextprotocol/servers/tree/main/src/<service>")
```
If not found in the official registry, broaden the search:
```
web_search("<service> MCP server site:github.com")
web_search("<service> model context protocol npm")
```
Look for the npm package name, required env vars, and what tools it exposes.

**2b. If no MCP server exists, check for webhook support:**
```
web_search("<service> webhook setup API")
web_search("<service> outgoing webhook documentation")
```

**2c. Find credential requirements:**
```
web_search("<service> personal access token OR API key OR OAuth setup")
```

**2d. Build and save the definition file:**

Once you have the information, write `workspace/integrations/<service>.md` using this format:

```markdown
# Integration: <Service>

## Type
[webhook / mcp-server / both]

## Credentials Required
- **Vault key:** `<service>.<credential_name>`
- **Type:** [Token / API Key / OAuth]
- **How to obtain:** [direct URL and steps]
- **Required scopes/permissions:** [list]
- **User prompt:** "[Exact text to ask the user for this credential]"

## MCP Server Setup
[If MCP server exists:]
{
  "id": "<service>",
  "name": "<Service>",
  "command": "npx",
  "args": ["-y", "<npm-package-name>"],
  "env": {
    "<ENV_VAR>": "vault:<service>.<credential_name>"
  },
  "enabled": true
}

[If no MCP server, write "No MCP server available — webhook-only integration."]

## Webhook Config
[If webhook-based:]
- **Events to subscribe:** [list]
- **Prometheus endpoint:** Ask user for their public URL or ngrok tunnel, then use `<url>/hooks/agent`
- **Auth:** Bearer token from Settings → Webhooks

[If not webhook-based, write "N/A"]

## Capabilities Unlocked
[List what Prometheus can do after this integration is set up]

## Verification
[What command/test to run to confirm the integration works]

## Rollback
- DELETE MCP server: `mcp_server_manage(action:"delete", id:"<service>", confirm:true)`
- Remove vault key via Settings UI
- Remove entry from `.prometheus/integrations-state.json`
```

---

### Step 3: Check Current State

```
read_file(".prometheus/integrations-state.json")
```

If the service shows `"status": "configured"` → tell the user it's already set up and what it can do. Stop here unless they want to reconfigure.

---

### Step 4: Ask for Credentials

Use the **User prompt** from the definition you built or loaded. Present it clearly.
Wait for the user's response. Never proceed without credentials.

If the user doesn't know how to get credentials, walk them through it step by step
using the "How to obtain" information from the definition.

---

### Step 5: Store Credentials in the Vault

```bash
curl -s -X POST http://127.0.0.1:18789/api/settings \
  -H "Content-Type: application/json" \
  -d '{"path":"vault:<service>.<key>","value":"<token>"}'
```

The `vault:` prefix encrypts the value. Never write credentials to plain files.
Never echo the credential back in any message.

---

### Step 6: Register the MCP Server (if applicable)

Preferred (native tool):
```json
mcp_server_manage({
  "action": "upsert",
  "config": <config-from-definition>,
  "connect": false
})
```

Fallback (HTTP API if tool unavailable):
```bash
curl -s -X POST http://127.0.0.1:18789/api/mcp/servers \
  -H "Content-Type: application/json" \
  -d '<config-from-definition>'
```

---

### Step 7: Connect the Server

Preferred (native tool):
```json
mcp_server_manage({ "action": "connect", "id": "<id>" })
```

Fallback (HTTP API):
```bash
curl -s -X POST http://127.0.0.1:18789/api/mcp/servers/<id>/connect
```

Wait for a success response. If it fails, check the error and troubleshoot:
- Wrong package name → re-search and correct
- Missing env var → check vault key names match
- npx timeout → try `npm install -g <package>` first

---

### Step 8: Set Up Webhooks (if applicable)

If the integration uses webhooks:
1. Use `webhook_manage(action:"get")` to inspect current state
2. If needed, configure `enabled/token/path` with `webhook_manage(action:"set", ...)`
3. Run `webhook_manage(action:"test")` to verify gateway-side webhook readiness
4. Ask the user for their public endpoint URL (or if they're using ngrok/cloudflare tunnel)
5. Guide them to register the webhook in the external service using `<url>/hooks/agent`
6. Confirm the events they want to receive

---

### Step 9: Verify

Run the verification step from the definition. Call a simple tool on the newly
connected MCP server, or test a webhook ping. Confirm it works before updating state.

---

### Step 10: Update State and Self-Knowledge

Write to `.prometheus/integrations-state.json`:
```json
{
  "integrations": {
    "<service>": {
      "status": "configured",
      "enabled": true,
      "configured_date": "<today>",
      "last_verified": "<today>",
      "capabilities": ["<from definition>"]
    }
  }
}
```

Then update `workspace/SELF.md` → `## Active Integrations` with a one-line entry.

---

### Step 11: Confirm to User

Tell the user:
- What was set up
- What Prometheus can now do with this integration
- A suggested first command to try it

---

## Rules

- ❌ Never write credentials to plain files — vault only
- ❌ Never echo credentials back to the user
- ❌ Never hardcode assumptions about which services exist or which MCP packages are available — always verify via web_search
- ✅ The definition cache in `workspace/integrations/` is yours to write and maintain
- ✅ If setup fails, diagnose, fix, and retry before giving up
- ✅ For webhook-only services (no MCP), the setup is still valid — document it clearly

---

## Handling Unknown or Niche Services

If `web_search` finds no MCP server for the service:
1. Check if the service has a REST API
2. Offer to set up a webhook instead (if the service supports outbound webhooks)
3. If neither, tell the user honestly: "I couldn't find an MCP server for X. I can monitor it via webhook if X supports outbound webhooks, or I can use its REST API directly via web_fetch. Which would you prefer?"

---

## Integration Definition Cache

`workspace/integrations/` — definitions you've researched and built.
These accumulate over time. Reuse them. Keep them accurate.
If a setup fails and you update the definition, save the corrected version.
