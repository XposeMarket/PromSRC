---
name: "windows-shell-playbook"
description: "Run and debug Windows PowerShell, cmd, terminal commands, processes, npm scripts, paths, environment checks, and CLI smoke tests safely. Use for Windows-specific command execution, quoting, process inspection, PATH failures, or disposable shell verification."
---

# Windows Shell Playbook

Use PowerShell-native commands and absolute paths. Treat every command invocation as a fresh process unless the tool explicitly guarantees persistent state.

## Core workflow

1. Confirm the runtime and working directory when platform or path assumptions matter.
2. Prefer `Get-ChildItem`, `Get-Content`, `Test-Path`, `Get-Process`, `Get-Command`, and other native PowerShell cmdlets.
3. Pass paths through `-LiteralPath`, especially when they contain spaces or wildcard characters.
4. Keep dependent operations in one PowerShell invocation or set the tool's working directory directly.
5. Capture exit code and output. Do not infer success from tool-call completion alone.
6. For mutating or destructive commands, resolve and verify the absolute target first. Use a disposable fixture when testing a recipe.

## Guardrails

- Do not translate a recursive delete or move through multiple shells.
- Do not assume Bash syntax, persistent `cd`, or inherited environment mutations.
- Do not kill processes by broad name unless the user explicitly intends every matching process.
- Use `Start-Process -WindowStyle Hidden` for non-interactive background helpers.
- Prefer repository-native scripts such as `npm run build` or `npm test` over reconstructed commands.
- Use file-editing tools for source edits; reserve the shell for execution, inspection, and mechanical transformations.

## Common checks

```powershell
Get-Location
Get-Command node
Test-Path -LiteralPath 'C:\path with spaces\file.txt'
Get-Content -Raw -LiteralPath 'config.json' | ConvertFrom-Json
Get-Process | Where-Object { $_.ProcessName -like '*node*' }
```

For command mappings, process recipes, JSON validation, npm workflows, environment handling, and recovery details, read [references/detailed-guide.md](references/detailed-guide.md) only when the task needs them.
