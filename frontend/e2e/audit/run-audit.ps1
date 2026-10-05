<#
  Wrapper for the UI/UX audit harness.

  Chromium must be started outside Node (the confined sandbox blocks Node's
  piped spawn with EPERM), so this wrapper:
    1. starts headless Chromium with a CDP port,
    2. waits for the endpoint,
    3. runs the Node harness against it,
    4. shuts Chromium down again.

  Examples:
    pwsh -File e2e/audit/run-audit.ps1 -Roles admin -Viewports desktop
    pwsh -File e2e/audit/run-audit.ps1
#>
param(
  [string]$Roles = '',
  [string]$Viewports = '',
  [string]$Script = 'e2e/audit/capture.mjs',
  [int]$Port = 9222,
  # Al verificar un build servido en otro puerto (p. ej. el worktree en :3001) el
  # backend rechaza el origen por CORS. Este modo relaja esa comprobación en el
  # navegador de pruebas; no cambia la app ni el backend.
  [switch]$CrossOrigin
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$frontend = (Resolve-Path (Join-Path $here '..\..')).Path
$chromeExe = 'C:\Users\adolf\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe'
$profileDir = Join-Path $here '.chrome-profile'
New-Item -ItemType Directory -Force -Path (Join-Path $here 'out') | Out-Null

$cdp = "http://127.0.0.1:$Port"
function Test-Cdp {
  try {
    $r = Invoke-WebRequest -Uri "$cdp/json/version" -TimeoutSec 2 -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch { return $false }
}

$started = $false
if ($CrossOrigin) {
  # El flag debe estar presente desde el arranque: si hay un Chromium previo sin
  # él, se reinicia.
  Get-Process -Name chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*ms-playwright*chromium-1243*' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}
if (-not (Test-Cdp)) {
  $chromeArgs = @(
    '--headless=new',
    "--remote-debugging-port=$Port",
    '--remote-allow-origins=*',
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--disable-features=Translate,MediaRouter',
    'about:blank'
  )
  if ($CrossOrigin) {
    $chromeArgs = @('--disable-web-security', '--disable-features=IsolateOrigins,site-per-process') + $chromeArgs
  }
  Write-Host "Starting Chromium: $chromeExe"
  Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs -WindowStyle Hidden
  $started = $true
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Cdp) { break }
  }
}
if (-not (Test-Cdp)) { throw "Chromium CDP endpoint did not come up at $cdp" }
Write-Host "CDP ready at $cdp"

if ($Roles) { $env:AUDIT_ROLES = $Roles }
if ($Viewports) { $env:AUDIT_VIEWPORTS = $Viewports }

$code = 0
Push-Location $frontend
try {
  & node $Script
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  if ($started) {
    Get-Process -Name chrome -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -like '*ms-playwright*chromium-1243*' } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host 'Chromium stopped.'
  }
}
exit $code
