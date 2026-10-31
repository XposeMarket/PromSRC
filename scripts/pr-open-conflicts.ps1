<#
.SYNOPSIS
  Conflict gate for one open PR branch. Uses git merge-tree --write-tree conflict stage
  records (stage 1/2/3 with mode and OID) for HEAD vs branch (task) and Base vs branch (baseline).
  Prints "STATUS: PASS|WARN|FAIL" then reason lines. Exit 1 only on FAIL.
  FAIL: invalid/unresolved branch or refs; git errors (diff or merge-tree exit <0 or >1);
        any unparseable conflict-record line; conflict on a task-changed path (derived from
        git diff Base...Head, unioned with -ChangedCsv); new conflict not in baseline;
        task touches a baseline conflict path.
  WARN: baseline conflict with identical stage 1/2/3 records on untouched paths; generated
        web-ui bundle conflicts; clean overlap (both edit a file, merge clean). Every WARN says
        the other PR remains BLOCKED pending rebase.
  -ChangedCsv is ADDITIVE only: it can add paths to the changed set, never remove git-derived ones.
.EXAMPLE
  powershell -File pr-open-conflicts.ps1 -Branch origin/pr-769 -Head HEAD -Base origin/main
#>
param(
  [Parameter(Mandatory = $true)][string]$Branch,
  [string]$Head = 'HEAD',
  [string]$Base = 'origin/main',
  [string]$ChangedCsv = ''
)
$ErrorActionPreference = 'Continue'
$fails = New-Object System.Collections.ArrayList
$warns = New-Object System.Collections.ArrayList
$suffix = "; other PR $Branch remains BLOCKED pending rebase"

function Resolves($ref) { git rev-parse --verify -q "$ref^{commit}" 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) }
function Finish {
  if ($fails.Count) { Write-Output 'STATUS: FAIL' } elseif ($warns.Count) { Write-Output 'STATUS: WARN' } else { Write-Output 'STATUS: PASS' }
  foreach ($f in $fails) { Write-Output "FAIL: $f" }
  foreach ($w in $warns) { Write-Output "WARN: $w" }
  if (-not $fails.Count -and -not $warns.Count) { Write-Output "clean: no conflicts or overlap with $Branch" }
  if ($fails.Count) { exit 1 } else { exit 0 }
}

# Returns @{ Code; Bad; Recs }. Recs[path] = list of "stage mode oid" for ALL stages (1, 2, 3).
# Bad = any non-blank record line (before the blank separator) that does not match, a bad tree line,
# or merge-tree exit 1 with zero parseable records.
function Get-Conflicts($a) {
  $out = @(git merge-tree --write-tree $a $Branch 2>$null)
  $code = [int]$LASTEXITCODE
  $recs = @{}
  $bad = $false
  if ($code -lt 0 -or $code -gt 1) { return @{ Code = $code; Bad = $true; Recs = $recs } }
  if ($code -eq 1) {
    if (-not $out.Count -or ("$($out[0])".Trim() -notmatch '^[0-9a-f]{40,64}$')) { $bad = $true }
    foreach ($line in @($out | Select-Object -Skip 1)) {
      $s = "$line".TrimEnd("`r")
      if (-not $s.Trim()) { break }
      if ($s -match '^(\d{6})\s+([0-9a-f]{40,64})\s+([0-3])\t(.+)$') {
        $p = $Matches[4]
        if (-not $recs.ContainsKey($p)) { $recs[$p] = @() }
        $recs[$p] += "$($Matches[3]) $($Matches[1]) $($Matches[2])"
      } else { $bad = $true }
    }
    if ($recs.Count -eq 0) { $bad = $true }
  }
  return @{ Code = $code; Bad = $bad; Recs = $recs }
}
function MtBroken($r) { return ($r.Code -lt 0) -or ($r.Code -gt 1) -or $r.Bad }
# Same = identical complete record sets (mode, OID and stage, including stage 1 merge base).
function Same($x, $y) {
  $a = @($x | Sort-Object)
  $c = @($y | Sort-Object)
  return ($a.Count -gt 0) -and (($a -join '|') -eq ($c -join '|'))
}

# ---------- refs ----------
if (-not (Resolves $Head)) { [void]$fails.Add("git error: head ref '$Head' does not resolve"); Finish }
if (-not (Resolves $Base)) { [void]$fails.Add("git error: base ref '$Base' does not resolve"); Finish }
if (-not (Resolves $Branch)) { [void]$fails.Add("invalid branch: '$Branch' does not resolve; conflict check cannot run"); Finish }

# ---------- task-changed paths: always git-derived, optionally unioned with supplied list ----------
$diffOut = @(git diff --name-only "$Base...$Head" 2>$null)
if ($LASTEXITCODE -ne 0) { [void]$fails.Add("git error: diff $Base...$Head failed (exit $LASTEXITCODE)"); Finish }
$changed = @($diffOut | ? { $_ })
if ($ChangedCsv) { $changed += @($ChangedCsv -split ',' | % { $_.Trim() } | ? { $_ }) }
$changed = @($changed | Sort-Object -Unique)
$changedSet = @{}
foreach ($c in $changed) { $changedSet[$c] = $true }

# ---------- merge-tree conflict records ----------
$task = Get-Conflicts $Head
if (MtBroken $task) { [void]$fails.Add("git error: merge-tree $Head vs $Branch exit $($task.Code) or unparseable conflict records"); Finish }
$baseMt = Get-Conflicts $Base
if (MtBroken $baseMt) { [void]$fails.Add("git error: merge-tree $Base vs $Branch exit $($baseMt.Code) or unparseable conflict records"); Finish }

foreach ($p in $task.Recs.Keys) {
  if ($p -like 'generated/public-web-ui/*') { [void]$warns.Add("generated web-ui bundle conflict on ${p}: regenerate with npm run sync:web-ui after the second PR merges$suffix"); continue }
  if ($changedSet.ContainsKey($p)) { [void]$fails.Add("conflict with $Branch on task-changed path $p"); continue }
  if ($baseMt.Recs.ContainsKey($p) -and (Same $task.Recs[$p] $baseMt.Recs[$p])) { [void]$warns.Add("baseline conflict with $Branch on $p (identical stage 1/2/3 records, not touched by task)$suffix"); continue }
  [void]$fails.Add("new conflict with $Branch on $p (not a baseline conflict vs $Base)")
}
foreach ($p in $baseMt.Recs.Keys) {
  if ($task.Recs.ContainsKey($p)) { continue }
  if ($changedSet.ContainsKey($p)) { [void]$fails.Add("task touches baseline conflict path $p ($Base vs $Branch)"); continue }
  [void]$warns.Add("baseline conflict on $p with $Branch (not in task, not touched by task)$suffix")
}

# ---------- clean overlap (both edit a file, merge clean) ----------
$theirs = @(git diff --name-only "$Base...$Branch" 2>$null)
if ($LASTEXITCODE -ne 0) { [void]$fails.Add("git error: diff $Base...$Branch failed (exit $LASTEXITCODE)"); Finish }
$shared = @($theirs | ? { $changedSet.ContainsKey($_) -and -not $task.Recs.ContainsKey($_) })
if ($shared.Count) { [void]$warns.Add("clean overlap with $Branch, merges clean but both edit: " + ($shared -join ', ') + ". Reviewer must check semantic interaction$suffix") }

Finish
