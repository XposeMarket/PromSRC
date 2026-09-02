[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$GatewayPid,
  [int]$ElectronPid = 0,
  [int]$CodexPid = 0,
  [int]$ClaudePid = 0,
  [string]$Url = 'http://127.0.0.1:18789',
  [string]$SessionId = '',
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [int]$DurationSec = 300,
  [int]$IntervalMs = 1000,
  [int]$StatusEverySamples = 5
)

# This monitor intentionally keeps the gateway root separate from its children.
# A gateway tree can include Chrome, Python, PowerShell, and other tool processes;
# summing that tree and calling it "gateway RSS" makes the diagnosis misleading.
$ErrorActionPreference = 'SilentlyContinue'
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $OutputPath
if ($outputDir) { New-Item -ItemType Directory -Force -Path $outputDir | Out-Null }

function Get-ProcessRows {
  $rows = [System.Collections.Generic.List[object]]::new()
  foreach ($row in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    # `$PID` is a read-only PowerShell automatic variable, so do not use the
    # case-insensitive name `$pid` for a process id here.
    $procId = [int]$row.ProcessId
    $userCpuSeconds = [double]($row.UserModeTime || 0) / 10000000
    $kernelCpuSeconds = [double]($row.KernelModeTime || 0) / 10000000
    [void]$rows.Add([pscustomobject]@{
      pid = $procId
      parentPid = [int]$row.ParentProcessId
      name = [string]$row.Name
      commandLine = [string]$row.CommandLine
      rssBytes = [int64]($row.WorkingSetSize || 0)
      privateBytes = [int64]($row.PrivatePageCount || 0)
      pageFileBytes = [int64]($row.PageFileUsage || 0) * 1024
      pageFaults = [int64]($row.PageFaults || 0)
      readOps = [int64]($row.ReadOperationCount || 0)
      readBytes = [int64]($row.ReadTransferCount || 0)
      writeOps = [int64]($row.WriteOperationCount || 0)
      writeBytes = [int64]($row.WriteTransferCount || 0)
      threads = [int]($row.ThreadCount || 0)
      handles = [int]($row.HandleCount || 0)
      cpuSeconds = $userCpuSeconds + $kernelCpuSeconds
    })
  }
  return $rows.ToArray()
}

function Get-DescendantIds {
  param([hashtable]$ByPid, [int]$Root)
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  if ($Root -le 0) { return ,$ids }
  [void]$ids.Add($Root)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($row in $ByPid.Values) {
      if ($ids.Contains([int]$row.parentPid) -and $ids.Add([int]$row.pid)) { $changed = $true }
    }
  }
  return ,$ids
}

function Test-BrowserProcess {
  param($Row)
  return ([string]$Row.name -match '(?i)^(chrome|msedge|chromium)(\.exe)?$' -or
    [string]$Row.commandLine -match '(?i)(chrome|chromium|ms-playwright|remote-debugging-port)')
}

function Test-ShellProcess {
  param($Row)
  return ([string]$Row.name -match '(?i)^(powershell|pwsh|cmd|python|python3|git|rg|npm|npx|bash|sh|wsl)(\.exe)?$')
}

function Get-Role {
  param($Row)
  if (Test-BrowserProcess $Row) { return 'browser' }
  if (Test-ShellProcess $Row) { return 'shell' }
  if ([string]$Row.name -match '(?i)node(\.exe)?$') { return 'node' }
  return 'other'
}

function Get-CpuPercent {
  param($Row, [hashtable]$PreviousCpu, [double]$WallSec)
  if (-not $PreviousCpu.ContainsKey([int]$Row.pid) -or $WallSec -le 0) { return 0.0 }
  $delta = [double]$Row.cpuSeconds - [double]$PreviousCpu[[int]$Row.pid]
  if ($delta -lt 0) { $delta = 0 }
  return [math]::Round(($delta / $WallSec / [math]::Max(1, [Environment]::ProcessorCount)) * 100, 3)
}

function Get-GroupSummary {
  param([array]$Rows)
  $rows = @($Rows)
  $topCpu = @($rows | Sort-Object cpuPercent -Descending | Select-Object -First 5 | ForEach-Object {
    [ordered]@{
      pid = $_.pid; name = $_.name; role = $_.role; cpuPercent = $_.cpuPercent
      rssBytes = $_.rssBytes; privateBytes = $_.privateBytes; threads = $_.threads; handles = $_.handles
    }
  })
  $topRss = @($rows | Sort-Object rssBytes -Descending | Select-Object -First 5 | ForEach-Object {
    [ordered]@{
      pid = $_.pid; name = $_.name; role = $_.role; rssBytes = $_.rssBytes
      privateBytes = $_.privateBytes; cpuPercent = $_.cpuPercent; threads = $_.threads; handles = $_.handles
    }
  })
  return [ordered]@{
    count = $rows.Count
    rssBytes = [int64](($rows | Measure-Object rssBytes -Sum).Sum)
    privateBytes = [int64](($rows | Measure-Object privateBytes -Sum).Sum)
    pageFileBytes = [int64](($rows | Measure-Object pageFileBytes -Sum).Sum)
    cpuPercent = [math]::Round([double](($rows | Measure-Object cpuPercent -Sum).Sum), 3)
    threads = [int](($rows | Measure-Object threads -Sum).Sum)
    handles = [int](($rows | Measure-Object handles -Sum).Sum)
    pageFaults = [int64](($rows | Measure-Object pageFaults -Sum).Sum)
    readBytes = [int64](($rows | Measure-Object readBytes -Sum).Sum)
    writeBytes = [int64](($rows | Measure-Object writeBytes -Sum).Sum)
    topCpu = $topCpu
    topRss = $topRss
  }
}

function Invoke-GatewayProbe {
  param([string]$Path)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$Url$Path" -TimeoutSec 10
    $body = [string]$response.Content
    $parsed = $null
    try { $parsed = $body | ConvertFrom-Json } catch {}
    $result = [ordered]@{
      ok = $true; status = [int]$response.StatusCode; latencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 3)
    }
    if ($Path -eq '/api/health' -and $parsed) {
      $result.memory = $parsed.memory
      $result.pid = $parsed.pid
    }
    if ($Path -eq '/api/status' -and $parsed) {
      $result.provider = $parsed.provider
      $result.currentModel = $parsed.currentModel
      $result.providerOnline = $parsed.providerOnline
      $result.gatewayQueues = $parsed.gatewayQueues
    }
    return $result
  } catch {
    return [ordered]@{ ok = $false; status = 0; latencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 3); error = [string]$_.Exception.Message }
  }
}

function Get-SystemSnapshot {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  return [ordered]@{
    availableMemoryBytes = [int64]($os.FreePhysicalMemory || 0) * 1024
    totalMemoryBytes = [int64]($os.TotalVisibleMemorySize || 0) * 1024
  }
}

function Get-StatusSession {
  if ([string]::IsNullOrWhiteSpace($SessionId)) { return $null }
  try {
    $encoded = [Uri]::EscapeDataString($SessionId)
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/sessions/$encoded" -TimeoutSec 10
    $parsed = $response.Content | ConvertFrom-Json
    return [ordered]@{
      ok = $true
      status = [int]$response.StatusCode
      activeRun = $parsed.activeRun
      settled = $parsed.settled
      messageCount = $parsed.messageCount
      lastActiveAt = $parsed.lastActiveAt
    }
  } catch {
    return [ordered]@{ ok = $false; error = [string]$_.Exception.Message }
  }
}

$previousCpu = @{}
$previousTotalCpuSeconds = $null
$previousTotalPageFaults = $null
$sampleNo = 0
$started = Get-Date
$lastTick = [Diagnostics.Stopwatch]::StartNew()
$lastSampleSeconds = 0.0
while ($lastTick.Elapsed.TotalSeconds -lt [math]::Max(1, $DurationSec)) {
  $sampleNo++
  $sampleElapsedSeconds = $lastTick.Elapsed.TotalSeconds
  $wallSec = [math]::Max(0.001, $sampleElapsedSeconds - $lastSampleSeconds)
  $rows = @(Get-ProcessRows)
  $byPid = @{}
  foreach ($row in $rows) {
    $row | Add-Member -NotePropertyName cpuPercent -NotePropertyValue (Get-CpuPercent $row $previousCpu $wallSec) -Force
    $row | Add-Member -NotePropertyName role -NotePropertyValue (Get-Role $row) -Force
    $byPid[[int]$row.pid] = $row
  }

  $totalCpuSeconds = [double](($rows | Measure-Object cpuSeconds -Sum).Sum)
  $totalPageFaults = [int64](($rows | Measure-Object pageFaults -Sum).Sum)

  $roots = [ordered]@{
    gateway = Get-DescendantIds $byPid $GatewayPid
    electron = Get-DescendantIds $byPid $ElectronPid
    codex = Get-DescendantIds $byPid $CodexPid
    claude = Get-DescendantIds $byPid $ClaudePid
  }

  $gatewayTree = @($rows | Where-Object { $roots.gateway.Contains([int]$_.pid) })
  $gatewayRoot = @($gatewayTree | Where-Object { [int]$_.pid -eq $GatewayPid })
  $gatewayBrowser = @($gatewayTree | Where-Object { $_.role -eq 'browser' })
  $gatewayShell = @($gatewayTree | Where-Object { $_.role -eq 'shell' })
  $gatewayRuntime = @($gatewayTree | Where-Object { $_.role -notin @('browser','shell') })
  $electronTree = @($rows | Where-Object { $roots.electron.Contains([int]$_.pid) })
  $electronExclusive = @($electronTree | Where-Object { -not $roots.gateway.Contains([int]$_.pid) })
  $codexTree = @($rows | Where-Object { $roots.codex.Contains([int]$_.pid) })
  $claudeTree = @($rows | Where-Object { $roots.claude.Contains([int]$_.pid) })

  $allProcessRows = @($gatewayTree + $electronTree + $codexTree + $claudeTree | Sort-Object pid -Unique | ForEach-Object {
    [ordered]@{
      pid = $_.pid; parentPid = $_.parentPid; name = $_.name; role = $_.role
      commandLine = ([string]$_.commandLine).Substring(0, [math]::Min(240, ([string]$_.commandLine).Length))
      rssBytes = $_.rssBytes; privateBytes = $_.privateBytes; pageFileBytes = $_.pageFileBytes
      cpuPercent = $_.cpuPercent; threads = $_.threads; handles = $_.handles; pageFaults = $_.pageFaults
      readBytes = $_.readBytes; writeBytes = $_.writeBytes
    }
  })

  $probe = [ordered]@{ health = Invoke-GatewayProbe '/api/health' }
  if ($sampleNo -eq 1 -or $sampleNo % [math]::Max(1, $StatusEverySamples) -eq 0) {
    $probe.status = Invoke-GatewayProbe '/api/status'
    $probe.session = Get-StatusSession
  }
  $system = Get-SystemSnapshot
  if ($null -ne $previousTotalCpuSeconds) {
    $idleDelta = if ($previousCpu.ContainsKey(0)) { [double]($rows | Where-Object pid -eq 0 | Select-Object -First 1 | ForEach-Object { $_.cpuSeconds }) - [double]$previousCpu[0] } else { 0 }
    $usedCpuDelta = [math]::Max(0, ($totalCpuSeconds - $previousTotalCpuSeconds) - [math]::Max(0, $idleDelta))
    $system.cpuPercent = [math]::Round(($usedCpuDelta / $wallSec / [math]::Max(1, [Environment]::ProcessorCount)) * 100, 3)
    $system.processPageFaultsPerSec = [math]::Round([math]::Max(0, $totalPageFaults - $previousTotalPageFaults) / $wallSec, 3)
  }
  $system.processCpuSeconds = [math]::Round($totalCpuSeconds, 3)
  $system.processPageFaults = $totalPageFaults
  $sample = [ordered]@{
    ts = (Get-Date).ToUniversalTime().ToString('o')
    sample = $sampleNo
    elapsedMs = [math]::Round(((Get-Date) - $started).TotalMilliseconds, 1)
    intervalMs = $IntervalMs
    gatewayPid = $GatewayPid
    system = $system
    probes = $probe
    groups = [ordered]@{
      gatewayRoot = Get-GroupSummary $gatewayRoot
      gatewayRuntime = Get-GroupSummary $gatewayRuntime
      gatewayTree = Get-GroupSummary $gatewayTree
      gatewayBrowser = Get-GroupSummary $gatewayBrowser
      gatewayShell = Get-GroupSummary $gatewayShell
      electronTree = Get-GroupSummary $electronTree
      electronExclusive = Get-GroupSummary $electronExclusive
      codexTree = Get-GroupSummary $codexTree
      claudeTree = Get-GroupSummary $claudeTree
    }
    processes = $allProcessRows
  }
  ($sample | ConvertTo-Json -Depth 14 -Compress) | Add-Content -LiteralPath $OutputPath -Encoding utf8
  $previousCpu = @{}
  foreach ($row in $rows) {
    $previousCpu[[int]$row.pid] = [double]$row.cpuSeconds
  }
  $previousTotalCpuSeconds = $totalCpuSeconds
  $previousTotalPageFaults = $totalPageFaults
  $lastSampleSeconds = $sampleElapsedSeconds
  Start-Sleep -Milliseconds ([math]::Max(100, $IntervalMs))
}
