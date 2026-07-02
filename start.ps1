# Single entry point. English-only content.
# If not installed, run install.ps1; otherwise launch the Electron app.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$vpy = Join-Path $root 'venv\Scripts\python.exe'
$nodeModules = Join-Path $root 'node_modules'

if ((-not (Test-Path $vpy)) -or (-not (Test-Path $nodeModules))) {
  Write-Host "[start] Not installed yet. Running installer..." -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'install.ps1')
}

Write-Host "[start] Launching SAM-Audio GUI..." -ForegroundColor Cyan
& npm start
