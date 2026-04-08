# Integration: Windows MCP

## Type
mcp-server

## Credentials Required
- None by default.
- Optional app-specific credentials may be needed depending on what apps you automate.

## MCP Server Setup

### Quick preset (recommended)
```json
integration_quick_setup({
  "action": "setup",
  "preset": "windows",
  "connect": true
})
```

This preset uses:
- command: `uvx`
- args: `windows-mcp`

### Manual equivalent
```json
mcp_server_manage({
  "action": "upsert",
  "config": {
    "id": "windows",
    "name": "Windows MCP",
    "transport": "stdio",
    "command": "uvx",
    "args": ["windows-mcp"],
    "enabled": true
  },
  "connect": true
})
```

## Webhook Config
N/A

## Capabilities Unlocked
- Control Windows desktop/apps through exposed MCP tools
- Query UI state and execute desktop actions via MCP server methods

## Verification
- `mcp_server_manage(action:"status")` shows `windows` connected
- `mcp_server_manage(action:"list_tools")` includes tools where `serverId` is `windows`

## Rollback
- `mcp_server_manage(action:"disconnect", id:"windows")`
- `mcp_server_manage(action:"delete", id:"windows", confirm:true)`
