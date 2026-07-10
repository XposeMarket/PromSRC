param(
  [string]$RunDate = '2026-07-09'
)
$ErrorActionPreference='Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$benchRoot = Join-Path $root 'benchmarks\agent-comparison'
$hermesDir = Join-Path $root 'oss agents\hermes-agent'
$ids = @('file_ops_basic_v1','shell_ops_basic_v1','browser_external_v1','local_web_debug_v1','desktop_basic_v1')
$results = @()
foreach ($id in $ids) {
  $promptPath = Join-Path $benchRoot "prompts\$id.md"
  $outDir = Join-Path $benchRoot "runs\$RunDate\hermes\$id"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Remove-Item (Join-Path $outDir 'events.jsonl') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $outDir 'summary.json') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $outDir 'stdout.txt') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $outDir 'stderr.txt') -Force -ErrorAction SilentlyContinue
  $eventsRel = "..\..\benchmarks\agent-comparison\runs\$RunDate\hermes\$id\events.jsonl"
  $env:HERMES_TELEMETRY_PATH = $eventsRel
  $env:HERMES_BENCHMARK_RUN_ID = "hermes_${RunDate}_${id}"
  $env:HERMES_BENCHMARK_ID = $id
  $prompt = Get-Content $promptPath -Raw
  $stdoutPath = Join-Path $outDir 'stdout.txt'
  $stderrPath = Join-Path $outDir 'stderr.txt'
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Push-Location $hermesDir
  try {
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'python'
    foreach ($arg in @('-m','uv','run','hermes','chat','--provider','openai-codex','-m','gpt-5.5','-Q','-q')) { [void]$psi.ArgumentList.Add($arg) }
    [void]$psi.ArgumentList.Add($prompt)
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
    Set-Content -Path $stdoutPath -Value $stdout -Encoding UTF8
    Set-Content -Path $stderrPath -Value $stderr -Encoding UTF8
  } finally {
    Pop-Location
  }
  $sw.Stop()
  $text = ((Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue) + (Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue)).Trim()
  $status = if ($exitCode -eq 0 -and $text -match 'FILE_OPS_BASIC_V1_PASS|SHELL_OPS_BASIC_V1_PASS|BROWSER_EXTERNAL_V1_PASS|LOCAL_WEB_DEBUG_V1_PASS|DESKTOP_BASIC_V1_PASS') { 'pass' } elseif ($text -match 'BLOCKED') { 'blocked' } else { 'fail' }
  $eventsPath = Join-Path $outDir 'events.jsonl'
  $toolCalls = 0; $toolErrors = 0; $modelCalls = 0; [int64]$tokensIn = 0; [int64]$tokensOut = 0; [int64]$toolMs = 0; [int64]$modelMs = 0
  if (Test-Path $eventsPath) {
    Get-Content $eventsPath | ForEach-Object {
      if (-not [string]::IsNullOrWhiteSpace($_)) {
        try {
          $e = $_ | ConvertFrom-Json
          if ($e.type -eq 'tool_call_end') { $toolCalls++; if ($e.status -ne 'ok') { $toolErrors++ }; if ($null -ne $e.latency_ms) { $toolMs += [int64]$e.latency_ms } }
          if ($e.type -eq 'model_call_end') { $modelCalls++; if ($null -ne $e.latency_ms) { $modelMs += [int64]$e.latency_ms }; if ($null -ne $e.input_tokens) { $tokensIn += [int64]$e.input_tokens }; if ($null -ne $e.output_tokens) { $tokensOut += [int64]$e.output_tokens } }
        } catch {}
      }
    }
  }
  $summary = [ordered]@{
    run_id = "hermes_${RunDate}_${id}"
    agent = 'hermes'
    benchmark_id = $id
    measurement_mode = 'black_box_cli_with_internal_telemetry'
    status = $status
    blocked_reason = $null
    total_wall_ms = [int64]$sw.ElapsedMilliseconds
    exit_code = $exitCode
    model_calls = $modelCalls
    model_latency_ms = $modelMs
    tool_calls = $toolCalls
    tool_latency_ms = $toolMs
    tool_errors = $toolErrors
    retries = $null
    tokens_input = if ($tokensIn -gt 0) { $tokensIn } else { $null }
    tokens_output = if ($tokensOut -gt 0) { $tokensOut } else { $null }
    estimated_cost_usd = $null
    artifacts = @(
      "benchmarks/agent-comparison/runs/$RunDate/hermes/$id/stdout.txt",
      "benchmarks/agent-comparison/runs/$RunDate/hermes/$id/events.jsonl"
    )
    final_output = $text
    notes = 'Hermes run via PowerShell wrapper; internal telemetry enabled by HERMES_TELEMETRY_PATH.'
  }
  $summary | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $outDir 'summary.json') -Encoding UTF8
  $results += [pscustomobject]@{ id=$id; status=$status; wall_ms=$sw.ElapsedMilliseconds; model_calls=$modelCalls; model_ms=$modelMs; tool_calls=$toolCalls; tool_ms=$toolMs; tool_errors=$toolErrors; tokens_in=$tokensIn; tokens_out=$tokensOut; exit_code=$exitCode; output=$text }
}
$results | ConvertTo-Json -Depth 8
