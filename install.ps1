# SAM-Audio GUI installer. English-only content (PS 5.1 cp949 pitfall).
# Steps: locate Python >=3.11 -> venv -> torch cu128 (Blackwell) -> sam-audio + server deps -> npm install -> HF login hint.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Info($m) { Write-Host "[install] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[install] $m" -ForegroundColor Yellow }

# ---- 1. Locate a suitable Python (>=3.11) --------------------------------
function Find-Python {
  foreach ($v in '3.12', '3.11') {
    try {
      & py "-$v" --version *> $null
      if ($LASTEXITCODE -eq 0) { return @('py', "-$v") }
    } catch {}
  }
  # PATH python, check version >= 3.11
  try {
    $ver = & python -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -eq 0) {
      $p = $ver.Split('.'); if ([int]$p[0] -eq 3 -and [int]$p[1] -ge 11) { return @('python') }
    }
  } catch {}
  return $null
}

$py = Find-Python
if (-not $py) {
  Warn "Python 3.11+ not found. Downloading Python 3.12 (silent install)..."
  $pyUrl = 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'
  $pyExe = Join-Path $env:TEMP 'python-3.12.7-amd64.exe'
  Invoke-WebRequest -Uri $pyUrl -OutFile $pyExe
  Start-Process -Wait -FilePath $pyExe -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1'
  $py = Find-Python
  if (-not $py) { throw "Python install failed. Please install Python 3.12 manually from python.org." }
}
Info ("Using Python: " + ($py -join ' '))

# ---- 2. venv -------------------------------------------------------------
$venv = Join-Path $root 'venv'
$vpy = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $vpy)) {
  Info "Creating venv..."
  & $py[0] $py[1..($py.Length-1)] -m venv $venv
}
Info "Upgrading pip..."
& $vpy -m pip install --upgrade pip setuptools wheel

# ---- 3. torch cu128 FIRST (Blackwell / RTX 50xx) -------------------------
Info "Installing torch/torchaudio/torchvision (CUDA 12.8)... this is large."
& $vpy -m pip install torch torchaudio torchvision --index-url https://download.pytorch.org/whl/cu128

# ---- 4. sam-audio + server deps ------------------------------------------
Info "Installing sam-audio + server deps (heavy git dependencies, be patient)..."
& $vpy -m pip install -r (Join-Path $root 'backend\requirements_infer.txt')

# ---- 5. Electron + vendored ffmpeg ---------------------------------------
try {
  & node --version *> $null
  if ($LASTEXITCODE -eq 0) {
    Info "Installing Electron + downloading ffmpeg (npm install)..."
    & npm install
  } else { Warn "node not found; skipping npm install. Install Node.js to run the GUI." }
} catch { Warn "node not found; skipping npm install." }

# ---- 6. torch CUDA sanity check ------------------------------------------
Info "Verifying torch CUDA..."
& $vpy -c "import torch;print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"

# ---- 7. HuggingFace gated access hint ------------------------------------
Write-Host ""
Warn "=============================================================="
Warn " SAM-Audio checkpoints are GATED on Hugging Face."
Warn " 1) Request access: https://huggingface.co/facebook/sam-audio-base"
Warn "    (also -small / -large if you want those sizes)"
Warn " 2) Log in so the app can download them (new 'hf' CLI):"
Warn "      venv\Scripts\hf auth login"
Warn "=============================================================="
Write-Host ""
Info "Install complete. Launch with the start script."
