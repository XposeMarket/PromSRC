# Terminal Tool Smoke Test Notes

Captured: 2026-06-19

Use this when testing whether Prometheus terminal commands work correctly on Windows.

## Confirmed Healthy Checks

Run a compact smoke set that covers foreground, shell selection, Node availability, and background process logs:

1. `cmd` foreground command
   - Example: `echo TERMINAL_OK`
   - Expected: prints `TERMINAL_OK` with exit code 0.

2. Direct PowerShell foreground command
   - Use the terminal tool with `shell:"powershell"` directly when available.
   - Expected: output is correct and current working directory reports normally.

3. Node command
   - Example: `node --version`
   - Expected: Node prints a valid version. On Raul's machine this was confirmed as `v20.20.2` on 2026-06-19.

4. Background terminal process
   - Start a short-running process, retrieve logs, and confirm the process finishes.
   - Expected: background start, log retrieval, and completion all work.

## Important PowerShell Quoting Guardrail

Do **not** wrap PowerShell scripts through `shell:"cmd"` as `powershell -Command ...` when the script uses PowerShell variables such as `$i`.

Observed failure: running PowerShell through cmd mangled `$i` variables in a loop during terminal-tool testing.

Preferred pattern:

```json
{
  "shell": "powershell",
  "command": "for ($i = 1; $i -le 3; $i++) { Write-Output \"tick $i\" }"
}
```

If direct `shell:"powershell"` is unavailable, keep the command simple or write a temporary `.ps1` script and run it with PowerShell explicitly, instead of nesting complex inline scripts through cmd.

## Reporting Pattern

When this smoke passes, report briefly:

- `cmd` foreground command: ✅
- direct PowerShell foreground command: ✅
- Node command: ✅
- background terminal process + logs: ✅
- Note: use direct PowerShell shell for PowerShell variables; avoid cmd-wrapped PowerShell for `$i` loops.
