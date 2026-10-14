#Requires -Version 5.1
<#
  Verja local antes de desplegar: los MISMOS comandos que corre el trabajo
  `test` del workflow .github/workflows/deploy.yml.

  Existe porque GitHub Actions está bloqueado por facturación: sin esto, un push
  a main llega a producción sin ninguna comprobación. No sustituye a CI, lo
  imita.

  Uso (este equipo tiene Windows PowerShell 5.1, no `pwsh` 7):
    powershell -ExecutionPolicy Bypass -File scripts\pre-deploy-check.ps1
    powershell -ExecutionPolicy Bypass -File scripts\pre-deploy-check.ps1 -SkipFrontend
    powershell -ExecutionPolicy Bypass -File scripts\pre-deploy-check.ps1 -SkipBackend

  Sale con código 0 solo si todo pasa.
#>
param(
    [switch]$SkipBackend,
    [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$failed = @()

function Write-Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "OK   $text" -ForegroundColor Green }
function Write-Bad($text)  { Write-Host "FALLA $text" -ForegroundColor Red }

function Find-Python {
    # El venv del repo es lo que usa el operador; si no está, se intenta el del sistema.
    $candidates = @(
        (Join-Path $root 'backend\.venv\Scripts\python.exe'),
        (Join-Path $root 'backend/.venv/bin/python'),
        'python'
    )
    foreach ($candidate in $candidates) {
        if ($candidate -eq 'python') { return $candidate }
        if (Test-Path $candidate) { return $candidate }
    }
    return 'python'
}

# -- Backend: pytest -m "not integration" ------------------------------------
# El marcador `integration` lo pone tests/conftest.py a los módulos que hablan
# con una API viva; CI los descarta igual. La suite hermética no necesita un
# Mongo real (usa dobles en memoria), así que basta con definir las variables.
if (-not $SkipBackend) {
    Write-Step 'Backend: pytest -m "not integration"'
    try {
        $python = Find-Python
        $env:MONGO_URL = 'mongodb://127.0.0.1:27017'
        $env:DB_NAME = 'restaurant_ci'
        Push-Location $root
        try {
            & $python -m pytest tests -m "not integration" -q
            if ($LASTEXITCODE -ne 0) { $failed += "backend (exit $LASTEXITCODE)" } else { Write-Ok 'backend' }
        } finally { Pop-Location }
    } catch {
        $failed += "backend ($($_.Exception.Message))"
        Write-Bad "backend: $($_.Exception.Message)"
    }
}

# -- Frontend: jest --runInBand y el build de producción ---------------------
# Ojo: CI además corre `npm ci` antes. Aquí no se corre a propósito (borra y
# reinstala node_modules, minutos), así que una deriva entre package.json y el
# lockfile no se detecta en local. Está anotado en el runbook.
if (-not $SkipFrontend) {
    Write-Step 'Frontend: jest'
    try {
        Push-Location (Join-Path $root 'frontend')
        try {
            $env:CI = 'true'
            npx craco test --watchAll=false --runInBand
            if ($LASTEXITCODE -ne 0) { $failed += "frontend tests (exit $LASTEXITCODE)" } else { Write-Ok 'frontend tests' }
        } finally { Pop-Location }
    } catch {
        $failed += "frontend tests ($($_.Exception.Message))"
        Write-Bad "frontend tests: $($_.Exception.Message)"
    }

    Write-Step 'Frontend: build de producción'
    try {
        Push-Location (Join-Path $root 'frontend')
        try {
            $env:CI = 'true'
            npx craco build
            if ($LASTEXITCODE -ne 0) { $failed += "frontend build (exit $LASTEXITCODE)" } else { Write-Ok 'frontend build' }
        } finally { Pop-Location }
    } catch {
        $failed += "frontend build ($($_.Exception.Message))"
        Write-Bad "frontend build: $($_.Exception.Message)"
    }
}

# -- Veredicto --------------------------------------------------------------
if ($failed.Count -gt 0) {
    Write-Host "`nVERJA EN ROJO - no desplegar:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "`nVERJA VERDE - se puede desplegar." -ForegroundColor Green
exit 0
