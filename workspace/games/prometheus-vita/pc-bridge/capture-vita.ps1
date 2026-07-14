param(
  [string]$Device = $env:VITA_VIDEO_DEVICE,
  [string]$Output = "$PSScriptRoot\latest-frame.jpg"
)
$ffmpeg = if ($env:FFMPEG) { $env:FFMPEG } else { "ffmpeg" }
if (-not $Device) {
  & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
  throw "Set VITA_VIDEO_DEVICE to the Vita UVC camera name shown above."
}
& $ffmpeg -hide_banner -loglevel error -f dshow -i "video=$Device" -frames:v 1 -q:v 2 -y $Output
if ($LASTEXITCODE -ne 0) { throw "Vita frame capture failed." }
Write-Host "Captured $Output"
