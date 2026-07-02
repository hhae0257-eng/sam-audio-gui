# Build a distributable zip (source only; venv/models/node_modules/vendor excluded).
# English-only content.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$out = 'D:\SAM-Audio-GUI배포본.zip'
$stage = Join-Path $env:TEMP ('samaudio_pkg_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$exclude = @('venv', 'node_modules', 'vendor', 'results', '.git', 'hf-cache')

Get-ChildItem -Path $root -Force | Where-Object {
  $exclude -notcontains $_.Name
} | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $stage -Recurse -Force
}

# keep empty runtime folders in the zip
foreach ($d in @('results')) {
  $p = Join-Path $stage $d
  New-Item -ItemType Directory -Force -Path $p | Out-Null
  New-Item -ItemType File -Force -Path (Join-Path $p '.gitkeep') | Out-Null
}

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -Force
Remove-Item $stage -Recurse -Force

Write-Host "[package] Created: $out" -ForegroundColor Green
