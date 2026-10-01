# Tool-failure audit over workspace\tool_audit.log.
# Usage:  powershell -NoProfile -File scripts\tool-failure-audit.ps1 [-Days 7] [-Top 30] [-Out temp\tool-failure-audit.md]
# Groups FAIL lines by tool + normalized error signature, with count, first/last seen and a sample.
param(
  [int]$Days = 7,
  [int]$Top = 30,
  [string]$Log = '',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
# Works from workspace\scripts\ or from skills\tool-failure-audit\scripts\: default to the Prometheus workspace root.
$wsRoot = Join-Path $env:APPDATA 'Prometheus\workspace'
if (-not $Log) { $Log = Join-Path $wsRoot 'tool_audit.log' }
if (-not $Out) { $Out = Join-Path $wsRoot 'temp\tool-failure-audit.md' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
if (-not (Test-Path -LiteralPath $Log)) { throw "tool_audit.log not found at $Log" }
$since = (Get-Date).ToUniversalTime().AddDays(-$Days).ToString('yyyy-MM-ddTHH:mm:ss')

function Normalize-Signature([string]$err) {
  $s = $err
  $s = $s -replace '\[exit (\d+)\] run=\S+ cwd=\S+', '[exit $1]'
  $s = $s -replace 'run_[0-9a-f]{8,}', 'run_*'
  $s = $s -replace '[A-Za-z]:\\[^\s"'']+', '<path>'
  $s = $s -replace '\b\d{3,}\b', 'N'
  $s = $s -replace '\s+', ' '
  if ($s.Length -gt 140) { $s = $s.Substring(0, 140) }
  return $s.Trim()
}

$total = 0; $fails = 0
$groups = @{}
# Stream the file (can be 40MB+).
$reader = [System.IO.File]::OpenText((Resolve-Path -LiteralPath $Log))
try {
  while (($line = $reader.ReadLine()) -ne $null) {
    if ($line.Length -lt 26 -or $line[0] -ne '[') { continue }
    $ts = $line.Substring(1, 19)
    if ($ts -lt $since) { continue }
    $total++
    $m = [regex]::Match($line, '^\[([^\]]+)\] FAIL ([A-Za-z0-9_]+)\((.*?)\) => (.*)$')
    if (-not $m.Success) { continue }
    $fails++
    $tool = $m.Groups[2].Value
    $argsText = $m.Groups[3].Value
    # tool_call bridge: attribute to the inner tool
    $inner = [regex]::Match($argsText, '"name":"([A-Za-z0-9_]+)"')
    if ($tool -eq 'tool_call' -and $inner.Success) { $tool = "tool_call:" + $inner.Groups[1].Value }
    $action = [regex]::Match($argsText, '"action":"([a-z_]+)"')
    if ($action.Success) { $tool = "$tool/$($action.Groups[1].Value)" }
    $err = $m.Groups[4].Value
    # workspace_run results start with the echoed command; keep the part from [exit ..]
    $ex = [regex]::Match($err, '\[exit [^\]]+\].*')
    if ($ex.Success) { $err = $ex.Value }
    $sig = Normalize-Signature $err
    $key = "$tool | $sig"
    if (-not $groups.ContainsKey($key)) {
      $groups[$key] = [pscustomobject]@{ Tool = $tool; Signature = $sig; Count = 0; First = $m.Groups[1].Value; Last = ''; Sample = $line.Substring(0, [Math]::Min(360, $line.Length)) }
    }
    $g = $groups[$key]; $g.Count++; $g.Last = $m.Groups[1].Value
  }
} finally { $reader.Close() }

$rows = $groups.Values | Sort-Object Count -Descending | Select-Object -First $Top
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Tool failure audit (last $Days days, since $since UTC)")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Calls: $total | FAIL: $fails | distinct signatures: $($groups.Count)")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| # | Count | Tool | Signature | First | Last |")
[void]$sb.AppendLine("|---|---|---|---|---|---|")
$i = 0
foreach ($r in $rows) {
  $i++
  $sigCell = ($r.Signature -replace '\|', '/')
  [void]$sb.AppendLine("| $i | $($r.Count) | $($r.Tool) | $sigCell | $($r.First.Substring(0,16)) | $($r.Last.Substring(0,16)) |")
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Samples")
$i = 0
foreach ($r in $rows) { $i++; [void]$sb.AppendLine("$i. ``$($r.Sample -replace '`', "'")``") }

$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$sb.ToString() | Set-Content -LiteralPath $Out -Encoding UTF8
"Calls=$total FAIL=$fails signatures=$($groups.Count) -> $Out"
$rows | Select-Object -First 15 Count, Tool, @{n='Last';e={$_.Last.Substring(5,11)}}, @{n='Signature';e={$_.Signature.Substring(0,[Math]::Min(80,$_.Signature.Length))}} | Format-Table -AutoSize | Out-String -Width 220
