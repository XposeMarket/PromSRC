<#
.SYNOPSIS
  Hard gates before a PromSRC PR branch may be pushed. Refuses to push on any FAIL.
.EXAMPLE
  powershell -File pr-finish.ps1 -Worktree C:\dev\promsrc-pr\my-slug -OpenPrBranches "perf/a,fix/b"
  powershell -File pr-finish.ps1 -NoPush        # dry run: gates only
.NOTES
  Run with workspace_run action:"start" + "wait". Never pass -SkipTsc
  except when the repository owner explicitly waives it; the waiver is printed into the PR body.
  Gates: location, spec, clean tree, rebased, forbidden paths, spec scope, size, web-ui sync (once,
  before the tests), test exists+passes, tsc, parity, open-PR conflicts, PR body.
  Speed: tsc --noEmit runs in the background from the start (incremental, .pr\tsc.tsbuildinfo seeded
  from dist\.tsbuildinfo), overlapping the web-ui and test gates; open-PR conflict helpers run in
  parallel. Writes .pr\PR_BODY.md and .pr\GATES.md (with a TIMING line).
.PARAMETER Live
  Windows local developer convention: defaults to PromSRC under the current user's home.
  Override -Live with the actual live checkout path. The live-checkout exclusion always applies.
#>
param(
  [string]$Worktree = (Get-Location).Path,
  [string]$OpenPrBranches = '',
  [int]$MaxLines = 400,
  [int]$MaxFiles = 8,
  [switch]$NoPush,
  [switch]$SkipTsc,
  [string]$Live = (Join-Path $HOME 'PromSRC')
)
$ErrorActionPreference = 'Continue'
$script:results = New-Object System.Collections.ArrayList
function Gate($name, $status, $detail) {
  [void]$script:results.Add([pscustomobject]@{ Gate = $name; Status = $status; Detail = $detail })
  Write-Output ("[{0}] {1}: {2}" -f $status, $name, $detail)
}
function Section($lines, $header) {
  # lines under "## <header>" until the next "## "
  $out = @(); $on = $false
  foreach ($l in $lines) {
    if ($l -match '^##\s+(.+?)\s*$') { $on = ($Matches[1] -ieq $header); continue }
    if ($on) { $out += $l }
  }
  return $out
}
function Field($lines, $name) {
  foreach ($l in $lines) { if ($l -match ("^\s*" + [regex]::Escape($name) + "\s*:\s*(.*)$")) { return $Matches[1].Trim() } }
  return ''
}
function Run($label, $cmd, $log) {
  Write-Host "  > $cmd"
  $o = cmd /c "$cmd 2>&1"
  $code = $LASTEXITCODE
  if ($log) { $o | Set-Content -Path $log -Encoding UTF8 }
  return @{ Code = $code; Tail = (($o | Select-Object -Last 12) -join "`n") }
}
# Background command (cmd /c, output to a log file so a full pipe can never stall it). Returns the Process.
function StartBg($cmd, $log) {
  Write-Host "  > (background) $cmd"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /s /c `"$cmd > `"$log`" 2>&1`""
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  return [System.Diagnostics.Process]::Start($psi)
}
function WaitBg($p, $log) {
  $p.WaitForExit()
  $tail = if (Test-Path $log) { (Get-Content $log -Tail 12) -join "`n" } else { '' }
  return @{ Code = $p.ExitCode; Tail = $tail }
}
# Child process with stdout+stderr read asynchronously (no pipe stall); collect with .P.WaitForExit().
function StartCaptured($file, $argLine) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $file
  $psi.Arguments = $argLine
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  return @{ P = $p; Out = $p.StandardOutput.ReadToEndAsync(); Err = $p.StandardError.ReadToEndAsync() }
}
$script:clock = [Diagnostics.Stopwatch]::StartNew()
$script:timing = [ordered]@{}
function Mark($label, $sw) { $script:timing[$label] = [Math]::Round($sw.Elapsed.TotalSeconds, 1) }

$wt = (Resolve-Path $Worktree).Path.TrimEnd('\')
Set-Location $wt
$prDir = Join-Path $wt '.pr'
New-Item -ItemType Directory -Force -Path $prDir | Out-Null

# ---------- 1. location ----------
$branch = (git branch --show-current).Trim()
if ($wt -ieq $Live.TrimEnd('\')) { Gate 'location' 'FAIL' 'running in the LIVE checkout. PR work only in a configured \promsrc-pr\ directory\<slug>.' }
elseif ($wt -notmatch '\\promsrc-pr\\') { Gate 'location' 'FAIL' "not under a configured \promsrc-pr\ directory: $wt" }
elseif (-not $branch -or $branch -eq 'main') { Gate 'location' 'FAIL' "bad branch '$branch'" }
else { Gate 'location' 'PASS' "$wt on $branch" }
if (-not (Test-Path "$wt\node_modules\typescript")) { Gate 'node_modules' 'FAIL' "missing. Fix: cmd /c mklink /J node_modules $Live\node_modules" }

# ---------- 2. spec ----------
$specPath = Join-Path $prDir 'SPEC.md'
$spec = @()
if (-not (Test-Path $specPath)) { Gate 'spec' 'FAIL' '.pr\SPEC.md missing (pr-start.ps1 creates it; the task owner fills it before code).' }
else {
  $spec = Get-Content $specPath
  $missing = @('Problem', 'Chosen approach', 'Acceptance', 'Files') | ? { -not ((Section $spec $_) -join '').Trim() }
  if ($spec -match '<fill') { $missing += 'unfilled <fill> placeholders' }
  if ($missing.Count) { Gate 'spec' 'FAIL' ("incomplete: " + ($missing -join ', ')) } else { Gate 'spec' 'PASS' 'required sections filled' }
}
$surface = (Field $spec 'Surface').ToLower()
$parity = Field $spec 'Parity'
$validSurface = $surface -match '^(both|sibling-check|single:(desktop|mobile|channel)|backend)$'
if (-not $validSurface) { Gate 'surface-tag' 'FAIL' "Surface must be both | sibling-check | single:desktop|mobile|channel | backend (got '$surface')" }
else { Gate 'surface-tag' 'PASS' $surface }

# ---------- 3. clean tree (everything committed, explicit paths) ----------
$dirty = @(git -c core.quotepath=off status --porcelain --untracked-files=no | ? { $_ -notmatch '\s\.pr/' })
$untracked = @(git -c core.quotepath=off ls-files --others --exclude-standard | ? { $_ -notmatch '^\.pr/' -and $_ -notmatch '^node_modules' })
if ($dirty.Count) { Gate 'clean-tree' 'FAIL' ("uncommitted tracked changes: " + (($dirty | Select -First 6) -join '; ') + ". Commit explicit paths or drop them.") }
else { Gate 'clean-tree' 'PASS' 'no uncommitted tracked changes' }
if ($untracked.Count) { Gate 'untracked' 'WARN' ("untracked files not in PR (forgot to add?): " + (($untracked | Select -First 8) -join ', ')) }

# ---------- 4. rebased on current origin/main ----------
git fetch origin -q 2>&1 | Out-Null
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) {
  $behind = (git rev-list --count HEAD..origin/main).Trim()
  Gate 'rebased' 'FAIL' "branch is $behind commits behind origin/main. Fix: git merge origin/main (no rebase: force-push is blocked for agents), then rerun."
} else { Gate 'rebased' 'PASS' ('on origin/main ' + (git rev-parse --short origin/main).Trim()) }
$ahead = [int](git rev-list --count origin/main..HEAD).Trim()
if ($ahead -eq 0) { Gate 'commits' 'FAIL' 'no commits ahead of origin/main' }
elseif ($ahead -gt 3) { Gate 'commits' 'WARN' "$ahead commits; squash-merge will flatten, but check none are unrelated" }

# ---------- changed files ----------
$changed = @(git -c core.quotepath=off diff --name-only origin/main...HEAD)
$gen = @($changed | ? { $_ -like 'generated/public-web-ui/*' })
$src = @($changed | ? { $_ -notlike 'generated/public-web-ui/*' })
$webTouched = @($src | ? { $_ -like 'web-ui/*' }).Count -gt 0
$tsTouched = @($src | ? { $_ -match '\.(ts|tsx)$' -or $_ -like 'tsconfig*' -or $_ -eq 'package.json' }).Count -gt 0

# ---------- typecheck starts now, in the background ----------
# It reads src/ only and keeps its own .pr\tsc.tsbuildinfo, so it never races a test's build:backend
# (which writes dist/). The result is collected in gate 10 after the web-ui and test gates.
$tscProc = $null
$tscLog = Join-Path $prDir 'tsc.log'
if (-not $SkipTsc -and $tsTouched) {
  # A pr-start warm-up still running owns .pr\tsc.tsbuildinfo: queue the typecheck behind it (inside
  # the background command) so the web-ui and test gates run meanwhile instead of waiting here.
  $waitFor = ''
  $warmPid = Join-Path $prDir 'tsc-warmup.pid'
  if (Test-Path $warmPid) {
    $wp = Get-Process -Id ([int]((Get-Content $warmPid -Raw).Trim())) -ErrorAction SilentlyContinue
    if ($wp -and $wp.ProcessName -in @('cmd', 'node')) {
      $waitFor = "powershell -NoProfile -Command Wait-Process -Id $($wp.Id) -Timeout 180 -ErrorAction SilentlyContinue & "
      Write-Host '  typecheck queued behind the pr-start warm-up (other gates run meanwhile)'
    }
    Remove-Item $warmPid -Force -ErrorAction SilentlyContinue
  }
  # dist\ and .pr\ sit at the same depth, so a copied buildinfo's relative paths stay valid; tsc still
  # rechecks every file whose content hash changed. Use whichever state is newer.
  $tscInfo = Join-Path $prDir 'tsc.tsbuildinfo'
  $distInfo = Join-Path $wt 'dist\.tsbuildinfo'
  if ((Test-Path $distInfo) -and (-not (Test-Path $tscInfo) -or (Get-Item $distInfo).LastWriteTimeUtc -gt (Get-Item $tscInfo).LastWriteTimeUtc)) { Copy-Item $distInfo $tscInfo -Force }
  $tscBin = if (Test-Path "$wt\node_modules\typescript\bin\tsc") { 'node node_modules/typescript/bin/tsc' } else { 'npx tsc' }
  $tscProc = StartBg "$waitFor$tscBin --noEmit -p tsconfig.json --incremental --tsBuildInfoFile .pr/tsc.tsbuildinfo" $tscLog
}

# Open-PR conflict helpers (gate 12) only read git state, so they all start now and run in parallel.
$conflictJobs = @()
$helper = Join-Path $PSScriptRoot 'pr-open-conflicts.ps1'
foreach ($ob in @($OpenPrBranches -split ',' | % { $_.Trim() } | ? { $_ -and $_ -ne $branch })) {
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$helper`" -Branch `"origin/$ob`" -Head HEAD -Base origin/main"
  if ($changed.Count) { $argLine += " -ChangedCsv `"$($changed -join ',')`"" }
  $conflictJobs += @{ Branch = $ob; Job = (StartCaptured 'powershell.exe' $argLine) }
}

$specFiles = @((Section $spec 'Files') | ? { $_ -match '^\s*-\s+`?([^`\s]+)`?' } | % { $Matches[1] })
$scopeNotes = ((Section $spec 'Scope notes') -join "`n")
function InSpec($f) {
  foreach ($p in $specFiles) { if ($f -like $p -or $f -eq $p) { return $true } }
  return $scopeNotes.Contains($f)
}

# ---------- 5. forbidden / generated paths ----------
$forbidden = @($changed | ? { $_ -match '^(dist|node_modules|artifacts|\.cache|captures|videos)/' -or $_ -match '(^|/)\.cache/' -or $_ -match '\.(log|tmp)$' })
$risky = @($changed | ? { ($_ -like 'workspace/*' -or $_ -like 'generated/bundled-skills/*') -and -not (InSpec $_) })
if ($forbidden.Count) { Gate 'forbidden-paths' 'FAIL' ("never commit: " + (($forbidden | Select -First 8) -join ', ')) }
elseif ($risky.Count) { Gate 'forbidden-paths' 'FAIL' ("workspace/ or generated/bundled-skills changes not listed in spec Files: " + (($risky | Select -First 8) -join ', ')) }
else { Gate 'forbidden-paths' 'PASS' 'no dist/cache/artifact/log churn' }
if ($gen.Count -and -not $webTouched) { Gate 'generated-web' 'FAIL' 'generated/public-web-ui changed but no web-ui source change: stray sync churn, drop it' }

# ---------- 6. spec scope ----------
$outOfScope = @($src | ? { -not (InSpec $_) -and $_ -notlike 'generated/*' -and $_ -ne 'package.json' })
if (-not $specFiles.Count) { Gate 'scope' 'FAIL' 'spec Files section lists no paths' }
elseif ($outOfScope.Count) { Gate 'scope' 'FAIL' ("files not in spec Files (add with a reason under '## Scope notes' or drop): " + (($outOfScope | Select -First 8) -join ', ')) }
else { Gate 'scope' 'PASS' "$($src.Count) source files, all in spec" }

# ---------- 7. size ----------
$lines = 0
git -c core.quotepath=off diff --numstat origin/main...HEAD | % {
  $p = $_ -split "`t"
  if ($p.Count -ge 3 -and $p[2] -notlike 'generated/*' -and $p[0] -ne '-') { $lines += [int]$p[0] + [int]$p[1] }
}
$sizeWhy = Field $spec 'Size justification'
if (($lines -gt $MaxLines -or $src.Count -gt $MaxFiles) -and -not $sizeWhy) { Gate 'size' 'FAIL' "$lines lines / $($src.Count) files exceeds $MaxLines/$MaxFiles. Split the PR or add 'Size justification:' to the spec." }
elseif ($lines -gt $MaxLines -or $src.Count -gt $MaxFiles) { Gate 'size' 'WARN' "$lines lines / $($src.Count) files (justified: $sizeWhy)" }
else { Gate 'size' 'PASS' "$lines lines / $($src.Count) files" }

# ---------- 8. web-ui: regenerate ONCE, before the tests ----------
# Tests read generated/public-web-ui and sync wipes it first, so it must finish before the test gate.
# sync:web-ui already ends with check:web-ui on current branches; older branches get it run separately.
if ($webTouched) {
  $webSw = [Diagnostics.Stopwatch]::StartNew()
  $syncScript = ''
  try { $syncScript = [string]((Get-Content (Join-Path $wt 'package.json') -Raw | ConvertFrom-Json).scripts.'sync:web-ui') } catch {}
  # The bundle is gitignored build output: regenerate it and make sure nothing under it is tracked again.
  $r2 = Run 'sync:web-ui' 'npm run -s sync:web-ui' (Join-Path $prDir 'webui-sync.log')
  $r = $r2
  if ($r2.Code -eq 0 -and $syncScript -notmatch 'check:web-ui') { $r = Run 'check:web-ui' 'npm run -s check:web-ui' (Join-Path $prDir 'webui.log') }
  if ($r.Code -eq 0) { Gate 'web-ui-sync' 'PASS' 'sync:web-ui + check:web-ui clean (bundle regenerated from source)' }
  else { Gate 'web-ui-sync' 'FAIL' ("sync:web-ui / check:web-ui failed (see .pr\webui-sync.log; generated/public-web-ui is untracked build output). " + $r.Tail) }
  $genDirty = @(git -c core.quotepath=off status --porcelain --untracked-files=all -- generated/public-web-ui)
  if ($r2.Code -ne 0) { Gate 'web-ui-committed' 'FAIL' ("sync:web-ui failed: " + $r2.Tail) }
  elseif ($genDirty.Count) { Gate 'web-ui-committed' 'FAIL' ("$($genDirty.Count) generated/public-web-ui files are tracked again; the bundle is untracked build output. Fix: git rm -r --cached generated/public-web-ui. e.g. " + (($genDirty | Select -First 4) -join '; ')) }
  else { Gate 'web-ui-committed' 'PASS' 'bundle regenerated; untracked build output, nothing to commit' }
  # Deleted paths still count for scope/size gates but cannot be syntax-checked.
  $nodeCheck = @($src | ? { $_ -like 'web-ui/*.js' -and (Test-Path -LiteralPath $_) } | % { node --check $_ 2>&1; if ($LASTEXITCODE) { "BAD $_" } } | ? { $_ -like 'BAD *' })
  if ($nodeCheck.Count) { Gate 'web-ui-syntax' 'FAIL' ($nodeCheck -join ', ') }
  Mark 'web-ui' $webSw
}

# ---------- 9. regression test exists + passes ----------
$testCmd = Field $spec 'Test'
$kind = ($branch -split '/')[0]
if (-not $testCmd -or $testCmd -match '^none') {
  if ($kind -in @('docs', 'chore')) { Gate 'test' 'WARN' "no test ($kind branch): $testCmd" }
  else { Gate 'test' 'FAIL' "spec needs 'Test: <command>' that runs a regression test added/extended in this PR (got '$testCmd')" }
} else {
  $testFile = ([regex]::Matches($testCmd, '[\w./-]+\.(regression\.ts|test\.(ts|js|mjs)|mjs|ts|js)') | % Value | Select -Last 1)
  if ($testFile -and -not ($changed -contains $testFile)) { Gate 'test-in-diff' 'FAIL' "$testFile is not added/changed in this PR. The test must exercise THIS change (both should-fire and should-not-fire)." }
  $testSw = [Diagnostics.Stopwatch]::StartNew()
  $r = Run 'test' $testCmd (Join-Path $prDir 'test.log')
  Mark 'test' $testSw
  if ($r.Code -eq 0) { Gate 'test' 'PASS' "$testCmd" } else { Gate 'test' 'FAIL' ("exit $($r.Code): " + $r.Tail) }
}

# ---------- 10. typecheck (started in the background above) ----------
if ($SkipTsc) { Gate 'tsc' 'WARN' 'SKIPPED by -SkipTsc (only valid with the repository owner''s explicit waiver)' }
elseif ($tscProc) {
  $r = WaitBg $tscProc $tscLog
  $script:timing['tsc (background, overlapped)'] = [Math]::Round(($tscProc.ExitTime - $tscProc.StartTime).TotalSeconds, 1)
  if ($r.Code -eq 0) { Gate 'tsc' 'PASS' 'tsc --noEmit clean (incremental, .pr\tsc.tsbuildinfo)' } else { Gate 'tsc' 'FAIL' ("errors (see .pr\tsc.log): " + $r.Tail) }
} else { Gate 'tsc' 'PASS' 'no .ts/package/tsconfig changes (n/a)' }

# ---------- 11. parity ----------
$mob = @($src | ? { $_ -like 'web-ui/src/mobile/*' -or $_ -eq 'web-ui/mobile.html' -or $_ -match '^web-ui/src/features/chat/.*mobile-' })
$desk = @($src | ? { ($_ -like 'web-ui/src/pages/*' -or $_ -like 'web-ui/src/features/chat/*' -or $_ -eq 'web-ui/src/desktop-entry.js' -or $_ -eq 'web-ui/index.html') -and $_ -notmatch 'mobile-' })
$oneSided = ($mob.Count -and -not $desk.Count) -or ($desk.Count -and -not $mob.Count)
if ($surface -eq 'both' -and $oneSided) { Gate 'parity' 'FAIL' ("Surface=both but only " + $(if ($mob.Count) { 'mobile' } else { 'desktop' }) + " files changed. Build the other side, or the shared module must be the one both surfaces import (say so in Parity:).") }
if ($oneSided -and -not $parity) { Gate 'parity' 'FAIL' "one-surface UI diff needs 'Parity:' in the spec: 'fixed both: ...' | 'not affected: <file:line evidence>' | 'follow-up #N' | 'single-surface: <reason>'" }
elseif ($surface -eq 'sibling-check' -and $parity -notmatch '^(fixed both|not affected|follow-up)') { Gate 'parity' 'FAIL' "sibling-check needs Parity: fixed both | not affected: <evidence> | follow-up #N (got '$parity')" }
elseif ($surface -eq 'sibling-check' -and $parity -match '^not affected' -and $parity -notmatch '[\w-]+\.(js|ts|css|html):\d+|screenshot|\.png') { Gate 'parity' 'FAIL' "'not affected' needs evidence: a file:line of the other surface's code path or a screenshot path" }
elseif (-not ($results | ? { $_.Gate -eq 'parity' })) { Gate 'parity' 'PASS' $(if ($parity) { $parity } else { "$surface (no one-sided UI diff)" }) }
if ($surface -eq 'both') { Gate 'parity-evidence' 'WARN' 'Surface=both: review requires desktop (?desktop=1) AND mobile (390x844) screenshots before approve' }

# ---------- 12. conflicts with other open PRs ----------
# Delegates to scripts/pr-open-conflicts.ps1 (merge-tree stage records, baseline vs task, regression-tested).
foreach ($cj in $conflictJobs) {
  $ob = $cj.Branch
  $cj.Job.P.WaitForExit()
  $out = @((($cj.Job.Out.Result + "`n" + $cj.Job.Err.Result) -split "`r?`n") | ? { $_ -ne '' })
  $st = [int]$cj.Job.P.ExitCode
  $statuses = @($out | ? { $_ -match '^STATUS:' })
  $status = (($statuses -replace '^STATUS:\s*', '') -join '').Trim()
  $detail = (($out | ? { $_ -match '^(FAIL|WARN): ' }) -replace '^(FAIL|WARN): ', '') -join '; '
  if ($st -notin @(0, 1)) { Gate "vs $ob" 'FAIL' "conflict helper exit $st (not 0 or 1; treated as failure). $detail" }
  elseif ($statuses.Count -ne 1 -or $status -notin @('PASS', 'WARN', 'FAIL')) { Gate "vs $ob" 'FAIL' "conflict helper returned $($statuses.Count) STATUS lines (need exactly one valid); exit $st" }
  elseif ($status -eq 'FAIL' -or $st -eq 1) { if ($status -eq 'FAIL' -and $st -eq 1) { Gate "vs $ob" 'FAIL' $detail } else { Gate "vs $ob" 'FAIL' "helper status/exit mismatch (status $status, exit $st). $detail" } }
  elseif ($status -eq 'WARN') { Gate "vs $ob" 'WARN' $detail }
  else { Gate "vs $ob" 'PASS' 'no conflicts with open PR' }
}


# ---------- 13. PR body ----------
$fails = @($results | ? Status -eq 'FAIL')
$risks = ((Section $spec 'Risks') -join "`n").Trim()
if (-not $risks) { Gate 'risks' 'WARN' 'spec has no Risks section (what could break, how we notice, rollback)' }
$gateTable = ($results | % { "| $($_.Gate) | $($_.Status) | $(($_.Detail -replace '\|', '/' -replace "`n", ' ').Substring(0, [Math]::Min(160, $_.Detail.Length))) |" }) -join "`n"
$body = @"
## Problem
$(((Section $spec 'Problem') -join "`n").Trim())

## Approach
$(((Section $spec 'Chosen approach') -join "`n").Trim())

## Acceptance criteria
$(((Section $spec 'Acceptance') -join "`n").Trim())

## Surfaces
Surface: $surface
PARITY: $(if ($parity) { $parity } else { 'n/a' })

## Risks / rollback
$(if ($risks) { $risks } else { '_not stated_' })

## Validation (pr-finish gates)
| Gate | Status | Detail |
|---|---|---|
$gateTable

Test: ``$testCmd``
"@
$body | Set-Content -Path (Join-Path $prDir 'PR_BODY.md') -Encoding UTF8
$script:timing['total'] = [Math]::Round($script:clock.Elapsed.TotalSeconds, 1)
$timingLine = 'TIMING ' + (($script:timing.GetEnumerator() | % { "$($_.Key) $($_.Value)s" }) -join ' | ')
"# pr-finish $(Get-Date -Format o) on $branch`n`n| Gate | Status | Detail |`n|---|---|---|`n$gateTable`n`n$timingLine" | Set-Content (Join-Path $prDir 'GATES.md') -Encoding UTF8

# ---------- verdict / push ----------
Write-Output ''
Write-Output $timingLine
if ($fails.Count) {
  Write-Output "BLOCKED: $($fails.Count) gate(s) failed. Fix them in this worktree and rerun. Nothing was pushed."
  exit 1
}
if ($NoPush) { Write-Output 'ALL GATES PASS (dry run, -NoPush). PR body: .pr\PR_BODY.md'; exit 0 }
# Plain push only: agents may not force-push. Catch up with `git merge origin/main` (satisfies the 'rebased' gate; squash-merge flattens it).
# If a branch was already rebased locally: `git merge -s ours --no-edit origin/<branch>` makes it fast-forward without changing the tree.
git push -u origin $branch 2>&1 | Select -Last 3
if ($LASTEXITCODE) { Write-Output 'PUSH FAILED'; exit 1 }
Write-Output "PUSHED $branch. Next: connector_github_create_pr {owner:'<repo-owner>', repo:'PromSRC', head:'$branch', base:'main', title:<imperative>, body:<contents of .pr\PR_BODY.md>} then hand to review (pr-pipeline stage 4)."
exit 0
