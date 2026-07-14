$ErrorActionPreference = 'Stop'

$skillDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $skillDir '..\..\..')

$result = [ordered]@{
    repoRoot = $repoRoot.Path
    pptxgenjs = $false
    libreOffice = $false
    powerPointCom = $false
    generationReady = $false
    renderReady = $false
}

$pptxModule = Join-Path $repoRoot 'node_modules\pptxgenjs\package.json'
$result.pptxgenjs = Test-Path -LiteralPath $pptxModule

$soffice = Get-Command soffice, libreoffice -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $soffice) {
    $knownLibreOfficePaths = @(
        (Join-Path $env:LOCALAPPDATA 'Prometheus\tools\LibreOffice\program\soffice.exe'),
        (Join-Path $env:ProgramFiles 'LibreOffice\program\soffice.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'LibreOffice\program\soffice.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $soffice = $knownLibreOfficePaths | Select-Object -First 1
}
$result.libreOffice = ($null -ne $soffice)

try {
    $powerPointType = [Type]::GetTypeFromProgID('PowerPoint.Application')
    if ($null -ne $powerPointType) {
        $app = [Activator]::CreateInstance($powerPointType)
        try {
            $result.powerPointCom = ($null -ne $app)
        } finally {
            if ($null -ne $app) {
                $app.Quit()
                [Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
            }
        }
    }
} catch {
    $result.powerPointCom = $false
}

$result.generationReady = ($result.pptxgenjs -or $result.powerPointCom)
$result.renderReady = ($result.libreOffice -or $result.powerPointCom)

$result | ConvertTo-Json

if (-not ($result.generationReady -and $result.renderReady)) {
    [Console]::Error.WriteLine('PPTX workflow blocked: provision an approved generation backend (pptxgenjs or PowerPoint) and render backend (LibreOffice or PowerPoint), then rerun this preflight.')
    exit 2
}
