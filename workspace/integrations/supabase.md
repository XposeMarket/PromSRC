# Integration: Supabase

## Type
mcp-server

## Credentials Required
- **Default auth mode:** OAuth (browser-based consent flow in MCP client)
- **Fallback auth mode:** PAT header
- **Vault keys (PAT fallback):**
  - `supabase.access_token`
  - `supabase.project_ref`
- **How to obtain:** Supabase Dashboard -> Account/Org settings -> access token; project ref from project settings.
- **Recommended scopes:** Least privilege, project-scoped where possible.

## MCP Server Setup

### Minimal (official endpoint)
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp"
    }
  }
}
```

### Safer (single project, read-only)
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true&features=database,docs"
    }
  }
}
```

### Scoped write-enabled
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&features=database,debugging,development"
    }
  }
}
```

### PAT fallback (no browser OAuth)
```json
{
  "id": "supabase",
  "name": "Supabase",
  "transport": "http",
  "url": "https://mcp.supabase.com/mcp?project_ref=${SUPABASE_PROJECT_REF}",
  "headers": {
    "Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN}"
  },
  "enabled": true
}
```

## SmallClaw Setup Commands
1. Import or upsert config:
```json
mcp_server_manage({
  "action": "import",
  "json": {
    "mcpServers": {
      "supabase": {
        "type": "http",
        "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true&features=database,docs"
      }
    }
  },
  "connect": false
})
```
2. Connect:
```json
mcp_server_manage({ "action": "connect", "id": "supabase" })
```
3. Verify:
```json
mcp_server_manage({ "action": "list_tools" })
```

### One-shot preset
```json
integration_quick_setup({
  "action": "setup",
  "preset": "supabase",
  "project_ref": "YOUR_PROJECT_REF",
  "mode": "safe",
  "connect": true
})
```
Optional PAT-header mode:
```json
integration_quick_setup({
  "action": "setup",
  "preset": "supabase",
  "project_ref": "YOUR_PROJECT_REF",
  "token": "vault:supabase.access_token",
  "connect": true
})
```

## Webhook Config
N/A

## Capabilities Unlocked
- Query database metadata and docs via Supabase MCP tools
- Run scoped MCP operations against a selected Supabase project

## Verification
- `mcp_server_manage(action:"status")` shows `supabase` as connected
- `mcp_server_manage(action:"list_tools")` includes `serverId: "supabase"`
- Run a simple Supabase MCP tool call, e.g. list tables for the selected project

## Rollback
- `mcp_server_manage(action:"disconnect", id:"supabase")`
- `mcp_server_manage(action:"delete", id:"supabase", confirm:true)`
- Remove Supabase vault entries if PAT fallback was used
