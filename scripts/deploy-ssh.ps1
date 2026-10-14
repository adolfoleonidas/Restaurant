#Requires -Version 5.1
<#
  Despliegue a producción por SSH, desde tu máquina.

  Camino alternativo al workflow de GitHub Actions, que hoy no puede correr
  porque la facturación de Actions está bloqueada. Hace tres cosas:

    1. verja local: corre los mismos comandos que el trabajo `test` de CI
       (se puede saltar con -SkipGate, a sabiendas);
    2. entra por SSH y ejecuta scripts/deploy-remote.sh con el commit elegido;
    3. comprueba el resultado desde fuera: el hash del bundle servido y el
       /api/health, para no dar por bueno un despliegue mirando solo la salida.

  Uso (este equipo tiene Windows PowerShell 5.1, no `pwsh` 7):
    powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1
    powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1 -SkipGate
    powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1 -Sha a1b2c3...
    powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1 -Yes

  El commit tiene que estar en origin/main: el script se niega a desplegar algo
  que no esté publicado, para que lo que corre en el VPS sea siempre lo mismo que
  está en el repo.
#>
param(
    [string]$Sha = '',
    [string]$SshHost = '179.236.76.74',
    [string]$Key = "$env:USERPROFILE\.ssh\gh-deploy",
    [string]$AppUrl = '',
    [switch]$SkipGate,
    [switch]$DryRun,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $AppUrl) { $AppUrl = "http://${SshHost}:8081" }

function Fail($message) { Write-Host "`nABORTADO: $message" -ForegroundColor Red; exit 1 }

# -- 1. Resolver y validar el commit -----------------------------------------
Push-Location $root
try {
    Write-Host '=== Resolviendo el commit' -ForegroundColor Cyan
    git fetch origin --quiet
    if ($LASTEXITCODE -ne 0) { Fail 'no se pudo hacer git fetch' }

    if (-not $Sha) { $Sha = (git rev-parse origin/main).Trim() }
    $Sha = $Sha.Trim()
    if ($Sha -notmatch '^[0-9a-f]{40}$') { Fail "SHA invalido: '$Sha' (se esperan 40 hex)" }

    git cat-file -e "$Sha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "el commit $Sha no existe en el repo local" }

    git merge-base --is-ancestor $Sha origin/main
    if ($LASTEXITCODE -ne 0) { Fail "el commit $Sha no esta en origin/main: publicalo antes de desplegarlo" }

    $short = $Sha.Substring(0, 7)
    Write-Host "commit a desplegar: $short" -ForegroundColor Green
    Write-Host "mensaje: $((git log -1 --pretty=%s $Sha).Trim())"
} finally { Pop-Location }

# -- 2. Verja local ---------------------------------------------------------
if ($SkipGate) {
    Write-Host "`n=== Verja local SALTADA a proposito (-SkipGate)" -ForegroundColor Yellow
} elseif ($DryRun) {
    Write-Host "`n=== DryRun: no se corre la verja"
} else {
    Write-Host '=== Verja local' -ForegroundColor Cyan
    # Se re-invoca con el MISMO PowerShell que corre esto: este equipo tiene 5.1
    # y no `pwsh`, así que pedirlo por nombre fallaría.
    $hostExe = (Get-Process -Id $PID).Path
    & $hostExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pre-deploy-check.ps1')
    if ($LASTEXITCODE -ne 0) { Fail 'la verja local esta en rojo' }
}

# -- 3. Plan y confirmación --------------------------------------------------
$remoteScript = Join-Path $PSScriptRoot 'deploy-remote.sh'
if (-not (Test-Path $remoteScript)) { Fail "falta $remoteScript" }
if (-not (Test-Path $Key)) { Fail "no encuentro la llave SSH: $Key" }

Write-Host "`n=== Plan" -ForegroundColor Cyan
Write-Host "  destino : root@${SshHost}:/docker/restaurant"
Write-Host "  commit  : $short"
Write-Host "  pasos   : fetch -> merge --ff-only -> docker compose up -d --build -> health"
Write-Host "  .env    : NO se toca (rotar JWT_SECRET desconecta a todos los usuarios)"

if ($DryRun) {
    Write-Host "`nDryRun: no se ha tocado el servidor." -ForegroundColor Yellow
    exit 0
}
if (-not $Yes) {
    $answer = Read-Host "`n¿Desplegar $short en produccion? (escribe 'si' para continuar)"
    if ($answer -ne 'si') { Write-Host 'Cancelado.' -ForegroundColor Yellow; exit 1 }
}

# -- 4. Ejecutar en el servidor ----------------------------------------------
# El script remoto se manda por stdin con `bash -s` y el SHA como argumento.
#
# Quitar TODO retorno de carro es obligatorio: un \r pegado al SHA hace fallar el
# merge (fatal: '1a26ea2?': not a non-negative integer).
#
# Y hay que quitar tambien los saltos de linea finales: al enviar por la tuberia,
# PowerShell añade su propio CRLF al final, asi que un script que ya terminaba en
# \n recibe una linea fantasma con solo \r. Bash intenta ejecutarla, falla con 127
# y `ssh` devuelve 127 - el despliegue remoto habia terminado bien, pero la
# comprobacion de exito lo daba por fallido.
$script = ([System.IO.File]::ReadAllText($remoteScript)) -replace "`r", ""
$script = $script.TrimEnd("`n", " ", "`t")
Write-Host "`n=== Desplegando (la reconstruccion tarda; puede ser 1-15 min)" -ForegroundColor Cyan

$output = $null
$code = 1
# PowerShell 5.1 convierte la salida normal de `ssh` por stderr (git y docker
# escriben ahí su progreso) en un error TERMINANTE cuando ErrorActionPreference es
# Stop. El script moría a mitad del despliegue, mataba la sesión SSH justo después
# de que docker compose parase el contenedor de frontend -que es el que sirve el
# puerto- y dejaba el sitio caído. Esta llamada va con la preferencia en Continue.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $output = $script | & ssh -o BatchMode=yes -o ConnectTimeout=15 -i $Key "root@$SshHost" "bash -s $Sha" 2>&1
    $code = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previous
}
$output | ForEach-Object { $_ }

# El veredicto sale de los marcadores que imprime el script remoto, no del codigo
# de salida de `ssh`: git y docker escriben su progreso por stderr y cualquier
# ruido de la conexion puede cambiarlo. `DEPLOY_FAIL` manda; `DEPLOY_OK` es la
# unica prueba de que llego al final.
$text = $output | Out-String
if ($text -match 'DEPLOY_FAIL') {
    Fail 'el despliegue remoto fallo (arriba esta el motivo DEPLOY_FAIL)'
}
if ($text -notmatch 'DEPLOY_OK') {
    if ($code -ne 0) { Fail "el despliegue remoto no llego al final (ssh salio con $code)" }
    Fail 'el despliegue remoto no confirmo DEPLOY_OK'
}
if ($code -ne 0) {
    Write-Host "Aviso: ssh salio con $code, pero el servidor confirmo DEPLOY_OK." -ForegroundColor Yellow
}

# -- 5. Verificar desde fuera, no solo por la salida del servidor ------------
# El servidor puede decir "listo" y el proxy seguir sirviendo el bundle viejo:
# esto lo mira desde la misma URL que usa el restaurante.
Write-Host "`n=== Verificacion desde fuera" -ForegroundColor Cyan
try {
    $page = Invoke-WebRequest -Uri "$AppUrl/" -UseBasicParsing -TimeoutSec 20
    $bundle = [regex]::Match($page.Content, 'static/js/main\.([a-z0-9]+)\.js')
    if ($bundle.Success) { Write-Host "bundle servido: main.$($bundle.Groups[1].Value).js" -ForegroundColor Green }
    else { Write-Host 'bundle servido: no encontrado en el HTML' -ForegroundColor Yellow }
} catch { Write-Host "raiz: ERROR $($_.Exception.Message)" -ForegroundColor Red }

$dbConnected = $true
try {
    $health = Invoke-WebRequest -Uri "$AppUrl/api/health" -UseBasicParsing -TimeoutSec 15
    Write-Host "health: $($health.Content)" -ForegroundColor Green
    # El cuerpo, no solo el 200: la API responde 200 con la base caida
    # (backend/server.py:52-61), asi que mirar el codigo HTTP daria por bueno un
    # despliegue sin base de datos.
    if ($health.Content -notmatch '"database":"connected"') {
        Write-Host 'La API responde pero la BASE NO esta conectada.' -ForegroundColor Red
        $dbConnected = $false
    }
} catch { Write-Host "health: CAIDO" -ForegroundColor Red; $dbConnected = $false }

if (-not $dbConnected) {
    Write-Host "`nDESPLEGADO $short, pero la base no responde: revisa los logs del backend." -ForegroundColor Red
    exit 1
}

Write-Host "`nDESPLEGADO $short" -ForegroundColor Green
Write-Host "Ojo: tu otro worktree (cobro-restaurante) tiene main en el commit viejo; ahi toca 'git pull'." -ForegroundColor Yellow
