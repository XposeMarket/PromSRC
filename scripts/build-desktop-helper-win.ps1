$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'The Windows desktop helper can only be built on Windows.'
}

$cmake = Get-Command cmake.exe -ErrorAction SilentlyContinue
if (-not $cmake) {
  $portableCMake = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\cmake-*\bin\cmake.exe') -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($portableCMake) { $cmake = $portableCMake }
}
if (-not $cmake) {
  throw 'cmake.exe was not found. Install Visual Studio 2022 Build Tools (Desktop development with C++) and CMake.'
}
$cmakePath = if ($cmake.Source) { $cmake.Source } else { $cmake.FullName }

$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'native\desktop-helper-windows'
$build = Join-Path $source 'build\vs2022'
$destinationDir = Join-Path $repo 'bin'
$binary = Join-Path $build 'Release\prometheus-desktop-helper.exe'

& $cmakePath -S $source -B $build -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed with exit code $LASTEXITCODE." }
& $cmakePath --build $build --config Release
if ($LASTEXITCODE -ne 0) { throw "CMake build failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $binary)) { throw "Desktop helper build completed but binary was not found at $binary." }

New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $destinationDir 'prometheus-desktop-helper.exe') -Force
Write-Host "Built bin\prometheus-desktop-helper.exe"
