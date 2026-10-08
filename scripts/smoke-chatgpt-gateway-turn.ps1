param(
  [Parameter(Mandatory=$true)][string]$Message,
  [string]$Session = "chatgpt_smoke_$(Get-Date -Format HHmmss)",
  [int]$Port = 32493,
  [int]$TimeoutSec = 600
)
# Live smoke: route a throwaway session to openai_codex/chatgpt on the running
# gateway and send one real chat turn. Prints tool calls + final text from SSE.
$base = "http://127.0.0.1:$Port"
$route = @{ providerId = 'openai_codex'; model = 'chatgpt' } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$base/api/sessions/$Session/model-route" -Body $route -ContentType 'application/json' | Out-Null
$body = @{ message = $Message; sessionId = $Session } | ConvertTo-Json
$resp = Invoke-WebRequest -Method Post -Uri "$base/api/chat" -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec $TimeoutSec
$final = ''
foreach ($line in ($resp.Content -split "`n")) {
  if ($line -notmatch '^data:') { continue }
  try { $ev = $line.Substring(5).Trim() | ConvertFrom-Json } catch { continue }
  switch ($ev.type) {
    'tool_call' { Write-Output ("TOOL_CALL {0} {1} origin={2}" -f $ev.action, (($ev.args | ConvertTo-Json -Compress -Depth 6) -replace '(.{300}).*','$1...'), $ev.origin) }
    'tool_result' { Write-Output ("TOOL_RESULT {0} error={1} {2}" -f $ev.action, $ev.error, (([string]$ev.result) -replace "`r?`n",' ' -replace '(.{300}).*','$1...')) }
    'done' { $final = [string]$ev.reply }
    'final' { $final = [string]$ev.reply }
    'error' { Write-Output "ERROR $($ev.message)" }
  }
}
Write-Output "SESSION $Session"
Write-Output "FINAL:"
Write-Output $final
