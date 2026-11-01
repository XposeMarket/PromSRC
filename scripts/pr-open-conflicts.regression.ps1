# Temp-repo regression for scripts/pr-open-conflicts.ps1. Exit 0 = all cases pass.
$ErrorActionPreference = 'Continue'
$helper = Join-Path $PSScriptRoot 'pr-open-conflicts.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('prconf-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root | Out-Null
$script:fails = 0
$script:count = 0

function Put($path, $text) {
  $dir = Split-Path -Parent $path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -LiteralPath $path -Value $text -Encoding ascii
}
function Commit($msg) { git add -A; git commit -q -m $msg }

# Base commit: cron.ts, c.txt, x.txt, e.txt (5 lines), generated bundle file. Branch 'main'.
function New-Base($name) {
  $d = Join-Path $root $name
  New-Item -ItemType Directory -Path $d | Out-Null
  Push-Location $d
  git init -q -b main
  git config user.email 't@example.com'; git config user.name 'test'
  Put 'cron.ts' 'a'; Put 'c.txt' 'a'; Put 'x.txt' 'x'; Put 'e.txt' "1`n2`n3`n4`n5"; Put 'generated/public-web-ui/app.js' 'g'
  Commit 'base'
  Pop-Location
  return $d
}

function Expect($name, $want, [string[]]$hArgs) {
  $script:count++
  $out = @(& powershell -NoProfile -File $helper @hArgs 2>&1 | ForEach-Object { "$_" })
  $code = $LASTEXITCODE
  $statuses = @($out | ? { $_ -match '^STATUS:' })
  $status = ($statuses -replace '^STATUS:\s*', '').Trim()
  $ok = ($statuses.Count -eq 1) -and ($status -eq $want) -and (($want -eq 'FAIL') -eq ($code -eq 1)) -and (($want -ne 'FAIL') -eq ($code -eq 0))
  if ($ok) { Write-Output "ok   $name -> $status (exit $code)" }
  else { $script:fails++; Write-Output "FAIL ${name}: want $want, got '$status' exit $code"; $out | % { Write-Output "     $_" } }
}

function Edit($f, $n, $t) { $l = @(Get-Content -LiteralPath $f); $l[$n - 1] = $t; Put $f ($l -join "`n") }
# Scn: open branch edits from base; main edits (optional); task branches from main and edits (optional).
# $extra = extra helper args (e.g. -ChangedCsv).
function Scn($name, $openEdit, $mainEdit, $taskEdit, $want, $base = 'main', [string[]]$extra = @()) {
  $d = New-Base $name
  Push-Location $d
  git checkout -q -b open
  & $openEdit; Commit 'open'
  git checkout -q main
  if ($mainEdit) { & $mainEdit; Commit 'main' }
  git checkout -q -b task
  if ($taskEdit) { & $taskEdit; Commit 'task' }
  Expect $name $want (@('-Branch', 'open', '-Head', 'task', '-Base', $base) + $extra)
  Pop-Location
}

# 1 baseline disjoint: main and open both changed e.txt L1 (baseline conflict); task does not touch e.txt
Scn 'baseline-warn' { Edit 'e.txt' 1 'B' } { Edit 'e.txt' 1 'A' } { Edit 'x.txt' 1 'T' } 'WARN'
# 2 new conflict: task and open both change x.txt, baseline clean
Scn 'new-conflict-fail' { Edit 'x.txt' 1 'O' } $null { Edit 'x.txt' 1 'T' } 'FAIL'
# 3 task touches a baseline conflict path (e.txt)
Scn 'touches-conflict-fail' { Edit 'e.txt' 1 'B' } { Edit 'e.txt' 1 'A' } { Edit 'e.txt' 5 'Z' } 'FAIL'
# 4 clean overlap: both edit e.txt on different lines, merge clean
Scn 'clean-overlap-warn' { Edit 'e.txt' 5 'O' } $null { Edit 'e.txt' 1 'T' } 'WARN'
# 5 clean pass: disjoint files
Scn 'clean-pass' { Edit 'x.txt' 1 'O' } $null { Edit 'c.txt' 1 'T' } 'PASS'
# 6 git error: unresolvable base ref
Scn 'error-fail' { Edit 'x.txt' 1 'O' } $null { Edit 'c.txt' 1 'T' } 'FAIL' 'no-such-base'
# 7 generated bundle conflict is WARN only
Scn 'generated-warn' { Edit 'generated/public-web-ui/app.js' 1 'O' } { Edit 'generated/public-web-ui/app.js' 1 'M' } { Edit 'x.txt' 1 'T' } 'WARN'
# 8 combined: new conflict on x.txt (FAIL) plus baseline e.txt conflict (WARN) -> FAIL
Scn 'combined-fail' { Edit 'x.txt' 1 'O'; Edit 'e.txt' 1 'B' } { Edit 'e.txt' 1 'A' } { Edit 'x.txt' 1 'T' } 'FAIL'
# 9 invalid branch (does not resolve) is FAIL even when ChangedCsv omits the touched path
$d = New-Base 'invalid-branch'
Push-Location $d; git checkout -q -b task; Edit 'x.txt' 1 'T'; Commit 'task'
Expect 'invalid-branch-fail' 'FAIL' @('-Branch', 'no-such-branch', '-Head', 'task', '-Base', 'main', '-ChangedCsv', 'c.txt')
Pop-Location
# 10 ChangedCsv omits a touched conflict path: git-derived changed set still FAILs
Scn 'changed-omits-fail' { Edit 'x.txt' 1 'O' } $null { Edit 'x.txt' 1 'T' } 'FAIL' 'main' @('-ChangedCsv', 'c.txt')
# 11 ChangedCsv is additive: listing a baseline-conflict path that task does not touch escalates WARN to FAIL
Scn 'changed-union-fail' { Edit 'e.txt' 1 'B' } { Edit 'e.txt' 1 'A' } { Edit 'x.txt' 1 'T' } 'FAIL' 'main' @('-ChangedCsv', 'e.txt')

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
if ($script:fails) { Write-Output "REGRESSION FAILED: $($script:fails) of $($script:count) case(s)"; exit 1 }
Write-Output "REGRESSION PASS: $($script:count) scenarios"
exit 0
