param(
  [string]$WorkspaceRoot = (Split-Path -Parent $PSScriptRoot)
)

$statusPath = Join-Path $WorkspaceRoot '.prometheus\gateway-runtime-status.json'
$logPath = Join-Path $WorkspaceRoot '.prometheus\logs\gateway-exit-watch.ndjson'
$lastPid = 0

while ($true) {
  try {
    if (-not (Test-Path -LiteralPath $statusPath)) {
      Start-Sleep -Milliseconds 500
      continue
    }

    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    $gatewayPid = [int]$status.pid
    if ($gatewayPid -le 0 -or $gatewayPid -eq $lastPid) {
      Start-Sleep -Milliseconds 500
      continue
    }

    $lastPid = $gatewayPid
    $process = Get-Process -Id $gatewayPid -ErrorAction Stop
    $startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $process.WaitForExit()
    $exitCode = $null
    try { $exitCode = $process.ExitCode } catch {}

    $entry = [ordered]@{
      timestamp = [DateTimeOffset]::UtcNow.ToString('o')
      observedPid = $gatewayPid
      observedAt = $startedAt
      exitCode = $exitCode
    } | ConvertTo-Json -Compress
    Add-Content -LiteralPath $logPath -Value $entry -Encoding UTF8
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
