---
name: JSON and Config Surgery
description: Safe patterns for reading, modifying, and writing Prometheus JSON config files without corruption. Use when touching config.json, managed-teams.json, cron/jobs.json, or any JSON file. Triggers on: update config, edit config, modify schedule, change agent settings, update team, cron json, jobs json, managed teams, config json, write json, patch json.
emoji: "⚙️"
version: 1.0.0
triggers: update config, edit config, modify schedule, change agent settings, update team, cron json, jobs json, managed teams, config json, write json, patch json, add field to json, remove from json, json file
---

# JSON and Config Surgery

JSON files are not line-safe. **Never use `edit()` (replace_lines) on a JSON file.** One misplaced comma or bracket corrupts the entire file silently.

The only safe pattern is: **Read → Parse → Modify → Validate → Write**.

---

## The Golden Rule

```
read → understand the full structure → construct corrected JSON → write the whole file back
```

This applies to every Prometheus JSON file without exception.

---

## Prometheus Config File Map

| File | Path | What it controls |
|---|---|---|
| Main config | `D:\Prometheus\.prometheus\config.json` | Models, gateway, tools, agents[], workspace path |
| Managed teams | `D:\Prometheus\.prometheus\managed-teams.json` | Team definitions, subagent IDs, manager config, chat |
| Cron jobs | `D:\Prometheus\.prometheus\cron\jobs.json` | All scheduled jobs (source of truth) |
| Heartbeat config | `D:\Prometheus\.prometheus\heartbeat\config.json` | Per-agent heartbeat enable/interval |
| Integrations state | `D:\Prometheus\.prometheus\integrations-state.json` | MCP server connection status |
| Skills state | `D:\Prometheus\workspace\skills\_state.json` | Installed skill metadata |

---

## Safe Edit Procedure

### Step 1: Read and validate the file

```
read(".prometheus/config.json")
```

Read the entire file. Understand the full structure before touching anything. Identify:
- The exact key path to the field you're changing
- What the current value is
- What the new value should be
- What other fields are siblings (so you don't accidentally delete them)

### Step 2: Validate JSON before writing

Before writing, review your constructed JSON mentally:
- Every `{` has a matching `}`
- Every `[` has a matching `]`
- Every key has a value
- No trailing commas on the last item in an object or array
- All strings are quoted
- Numbers and booleans are NOT quoted

**Common mistakes that break JSON:**
```json
// WRONG — trailing comma
{ "a": 1, "b": 2, }

// WRONG — unquoted string
{ "name": hello }

// WRONG — missing comma between fields
{ "a": 1 "b": 2 }

// WRONG — single quotes
{ 'name': 'value' }
```

### Step 3: Write the entire file

```
write(".prometheus/config.json", "<full corrected JSON>")
```

Write the complete file, not just the changed section.

### Step 4: Verify by reading back

```
read(".prometheus/config.json")
```

Confirm the file is valid and the change is correct.

---

## Common Operations

### Add a new agent to config.json

```json
// Current agents array:
"agents": [
  { "id": "agent_a", "name": "Agent A", ... }
]

// After adding agent_b — note NO trailing comma after last item:
"agents": [
  { "id": "agent_a", "name": "Agent A", ... },
  { "id": "agent_b", "name": "Agent B", "description": "...", "maxSteps": 15 }
]
```

**Always prefer `spawn_subagent()` for creating agents** — it handles config registration automatically. Only edit config.json directly for targeted patches.

### Update a cron schedule in jobs.json

```json
// Find the job by ID, update just the "schedule" field
// Leave all other fields exactly as they are
{
  "id": "job_abc123",
  "name": "X Poster",
  "schedule": "0 9 * * *",   // change this
  "prompt": "...",             // leave this
  "enabled": true              // leave this
}
```

**Always prefer `schedule_job({ action: "update", job_id: "...", ... })` for schedule changes.** The tool handles validation and hot-reload. Only edit jobs.json directly if the tool is unavailable.

### Update managed-teams.json

managed-teams.json is large and nested. Be extra careful:

1. Read the whole file
2. Identify the specific team by `id`
3. Within that team, find the exact field
4. Make the minimum change needed
5. Write back the entire file

**Always prefer `team_manage()` for team changes.** Direct JSON edits bypass the in-memory cache invalidation — the change may not take effect until gateway restart.

---

## Validating JSON via PowerShell

After writing any JSON file, validate it immediately:

```powershell
powershell -Command "try { Get-Content '.prometheus\config.json' | ConvertFrom-Json; Write-Output 'VALID' } catch { Write-Output 'INVALID: ' + $_.Exception.Message }"
```

If it returns `INVALID`, you have a syntax error. Read the file again, find the error, fix it, rewrite.

---

## Backup Before Risky Edits

For config.json or managed-teams.json (the two most critical files), always back up before a large edit:

```
shell("copy D:\Prometheus\.prometheus\config.json D:\Prometheus\.prometheus\config.json.bak")
```

If the write goes wrong, the backup is your recovery path.

---

## What Happens When JSON is Corrupted

| File corrupted | Effect |
|---|---|
| `config.json` | Gateway fails to start. Prometheus is down until fixed. |
| `managed-teams.json` | Teams panel broken. Teams may reset to defaults. |
| `cron/jobs.json` | All scheduled jobs disappear on next gateway restart. |
| `heartbeat/config.json` | Heartbeat falls back to defaults. Agents may stop ticking. |

**Recovery:** Restore from `.bak` backup, or reconstruct from the gateway error logs which will show a JSON parse error with the line number.

---

## Formatting Standards

All Prometheus JSON files use 2-space indentation. Match this when writing:

```json
{
  "key": "value",
  "nested": {
    "inner": "value"
  },
  "array": [
    "item1",
    "item2"
  ]
}
```

Not 4-space, not tabs, not minified. Consistent formatting makes diffs readable and avoids unnecessary git noise.

---

## When to Use Tools vs. Direct File Edit

| Situation | Use tool | Use direct file edit |
|---|---|---|
| Create/update agent | `spawn_subagent()` | Only for targeted patches tool can't do |
| Create/update schedule | `schedule_job()` | Only if tool unavailable |
| Update team config | `team_manage()` | Only if tool unavailable |
| Update heartbeat | `update_heartbeat()` | Only if tool unavailable |
| Add a custom field not exposed by any tool | — | Direct edit (with backup) |

**Rule:** Prefer tools. They validate inputs, handle cache invalidation, and reload live state. Direct JSON edits are a last resort.
