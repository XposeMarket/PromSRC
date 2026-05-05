---
name: windows-shell-playbook
description: # Windows Shell Playbook
emoji: "🧩"
version: 1.0.0
---

# Windows Shell Playbook

This machine runs Windows 11. Bash/Linux commands fail here. Use PowerShell or cmd.exe equivalents below.

`run_command` calls execute in a fresh Windows process each time (captured output by default). Prefer explicit PowerShell invocation: `powershell -NoProfile -Command "..."` or `powershell -NoProfile -File script.ps1`.

---

## File & Directory Operations

| What you want | Linux (DO NOT USE) | Windows (USE THIS) |
|---|---|---|
| List directory | `ls -la` | `dir` or `powershell -NoProfile -Command "Get-ChildItem -Force"` |
| List with sizes | `ls -lah` | `powershell -NoProfile -Command "Get-ChildItem \| Select-Object Name,Length"` |
| Check file exists | `test -f file` | `powershell -NoProfile -Command "Test-Path 'file'"` |
| Check dir exists | `test -d dir` | `powershell -NoProfile -Command "Test-Path 'dir' -PathType Container"` |
| Read file | `cat file.txt` | `powershell -NoProfile -Command "Get-Content 'file.txt'"` |
| Read first N lines | `head -20 file` | `powershell -NoProfile -Command "Get-Content 'file.txt' -TotalCount 20"` |
| Read last N lines | `tail -20 file` | `powershell -NoProfile -Command "Get-Content 'file.txt' -Tail 20"` |
| Copy file | `cp src dst` | `copy src dst` or `powershell -NoProfile -Command "Copy-Item 'src' 'dst'"` |
| Move/rename | `mv src dst` | `move src dst` |
| Delete file | `rm file` | `del file` or `powershell -NoProfile -Command "Remove-Item 'file'"` |
| Delete dir recursively | `rm -rf dir` | `powershell -NoProfile -Command "Remove-Item 'dir' -Recurse -Force"` |
| Create directory | `mkdir -p dir` | `mkdir dir` (cmd) or `powershell -NoProfile -Command "New-Item -ItemType Directory -Force 'dir'"` |
| Find files by name | `find . -name "*.ts"` | `powershell -NoProfile -Command "Get-ChildItem -Recurse -Filter '*.ts'"` |
| Find files with content | `grep -r "term" .` | `powershell -NoProfile -Command "Select-String -Path '.\*' -Pattern 'term' -Recurse"` |
| Disk space | `df -h` | `powershell -NoProfile -Command "Get-PSDrive C \| Select-Object Used,Free"` |
| File size | `du -sh file` | `powershell -NoProfile -Command "(Get-Item 'file').Length"` |

---

## Path Conventions

Windows uses backslashes, but PowerShell accepts forward slashes in most contexts:

```
# Both work in PowerShell:
Get-Content "$env:APPDATA\Prometheus\workspace\SOUL.md"
Get-Content "$env:APPDATA/Prometheus/workspace/SOUL.md"
```

**Prometheus paths:**
- Data root: `$env:APPDATA\Prometheus\`
- Workspace root: `$env:APPDATA\Prometheus\workspace\`
- Skills: `$env:APPDATA\Prometheus\workspace\skills\`
- Memory: `$env:APPDATA\Prometheus\workspace\memory\`
- Config dir: `$env:APPDATA\Prometheus\.prometheus\`
**When constructing paths in shell:** Use backslash or wrap in quotes to handle spaces.

---

## JSON Operations

**Read and pretty-print a JSON file:**
```powershell
powershell -NoProfile -Command "Get-Content '$env:APPDATA\Prometheus\.prometheus\config.json' | ConvertFrom-Json | ConvertTo-Json -Depth 10"
```

**Read a specific field:**
```powershell
powershell -NoProfile -Command "(Get-Content '$env:APPDATA\Prometheus\.prometheus\config.json' | ConvertFrom-Json).gateway.port"
```

**Validate JSON is parseable:**
```powershell
powershell -NoProfile -Command "try { Get-Content 'file.json' | ConvertFrom-Json; Write-Output 'VALID' } catch { Write-Output ('INVALID: ' + $_.Exception.Message) }"
```

**Never** use `python3 -m json.tool` — Python is not guaranteed to be on PATH on this machine.

---

## Environment & Process

| What you want | Linux | Windows |
|---|---|---|
| Print env var | `echo $VAR` | `echo %VAR%` (cmd) or `$env:VAR` (PS) |
| List all env vars | `env` | `powershell -NoProfile -Command "Get-ChildItem Env:"` |
| List running processes | `ps aux` | `powershell -NoProfile -Command "Get-Process"` |
| Find process by name | `pgrep node` | `powershell -NoProfile -Command "Get-Process -Name 'node'"` |
| Kill process by PID | `kill 1234` | `powershell -NoProfile -Command "Stop-Process -Id 1234 -Force"` |
| Kill process by name | `pkill node` | `powershell -NoProfile -Command "Stop-Process -Name 'node' -Force"` |
| Check port in use | `lsof -i :18789` | `powershell -NoProfile -Command "netstat -ano \| findstr :18789"` |
| Current directory | `pwd` | `cd` (cmd) or `Get-Location` (PS) |
| Which binary | `which node` | `powershell -NoProfile -Command "Get-Command node"` |

---

## Node / npm (Prometheus specific)

```powershell
# Build Prometheus
powershell -NoProfile -Command "Set-Location 'D:\Prometheus'; npm run build"

# Start Prometheus
powershell -NoProfile -Command "Set-Location 'D:\Prometheus'; npm start"

# Check Node version
powershell -NoProfile -Command "node --version"

# Check if a package is installed
powershell -NoProfile -Command "Set-Location 'D:\Prometheus'; npm list <package>"

# Run a specific npm script
powershell -NoProfile -Command "Set-Location 'D:\Prometheus'; npm run <script-name>"
```

**Build after src/ changes is mandatory.** `src/` compiles to `dist/` via tsc. Never edit `dist/` directly.

---

## Networking

```powershell
# Test if a port is listening
powershell -NoProfile -Command "Test-NetConnection -ComputerName localhost -Port 18789"

# Check gateway is up
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'http://127.0.0.1:18789/api/status' -UseBasicParsing"

# Simple HTTP GET
powershell -NoProfile -Command "(Invoke-WebRequest -Uri 'http://127.0.0.1:18789/api/status' -UseBasicParsing).Content"
```

---

## Runtime / Diagnostic

```powershell
# Check Node is available
node --version

# Check npm is available
npm --version

# Check if a file exists before reading
powershell -NoProfile -Command "if (Test-Path 'path\to\file') { Get-Content 'path\to\file' } else { Write-Output 'NOT FOUND' }"

# Get last N lines of a log
powershell -NoProfile -Command "Get-Content 'D:\Prometheus\gateway.log' -Tail 50"

# Check error log
powershell -NoProfile -Command "Get-Content 'D:\Prometheus\gateway.err.log' -Tail 30"
```

---

## Non-Windows / Stubbed Environment Fallback

If you are not on a real Windows host (or PowerShell/cmd behavior is stubbed), do **not** force these commands.

- Detect mismatch early: if `powershell` is unavailable, or a command returns platform/command-not-found errors, stop assuming Windows semantics.
- Run OS-native commands for that runtime (`bash`/`zsh` patterns on Linux/macOS) instead of forcing PowerShell syntax.
- For deterministic file work, prefer Prometheus tools (`read_file`, `list_directory`, `grep_files`) over shell emulation.
- Use runtime-correct absolute paths for the detected OS; never reuse `D:\Prometheus\...` on non-Windows hosts.
- In your final report, explicitly state the mismatch and the fallback path/toolchain used.

---

## Shell Execution Notes

- `run_command` calls run in a new subprocess each time — **no persistent state between calls**
- Working directory resets each call — always use absolute paths or `Set-Location ...; <command>` in one call
- PowerShell commands should be prefixed: `powershell -NoProfile -Command "..."`
- Escape double quotes inside PowerShell strings with backtick: `` `" ``
- For multi-line PowerShell, use a script file: write script → run `powershell -NoProfile -File script.ps1`

---

## DO NOT USE on Windows

These will either fail silently or error:
- `ls`, `cat`, `grep`, `find`, `rm`, `cp`, `mv`, `mkdir -p`
- `df -h`, `du -sh`, `ps aux`, `kill`, `which`
- `python3`, `python` (not guaranteed on PATH)
- `curl` (use `Invoke-WebRequest` instead)
- Any bash-specific syntax: complex `$()` subshell patterns or bash-only pipe behavior