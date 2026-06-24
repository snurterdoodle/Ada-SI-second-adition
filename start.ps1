#Requires -Version 5.1
<#
.SYNOPSIS
  Start Ada-SI natively on Windows (no Docker).

.DESCRIPTION
  Sets up a local Python venv, installs dependencies, optionally builds the frontend,
  then starts LiteLLM, tool-runtime, and the chat server.

.PARAMETER Dev
  Run the Vite dev server (http://localhost:5173) instead of serving built static files.

.PARAMETER SkipBuild
  Skip `npm run build` even when static assets look missing.

.PARAMETER NoBrowser
  Do not open a browser tab after services are ready.

.PARAMETER InstallOnly
  Install Python/Node dependencies and exit without starting services.

.EXAMPLE
  .\start.ps1

.EXAMPLE
  .\start.ps1 -Dev
#>
param(
    [switch]$Dev,
    [switch]$SkipBuild,
    [switch]$NoBrowser,
    [switch]$InstallOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$LogsDir = Join-Path $Root 'logs'
$PidFile = Join-Path $Root '.ada-si.pids'
$VenvDir = Join-Path $Root '.venv'
$LitellmVenvDir = Join-Path $Root '.venv-litellm'
$PythonExe = Join-Path $VenvDir 'Scripts\python.exe'
$LitellmPythonExe = Join-Path $LitellmVenvDir 'Scripts\python.exe'
$LitellmExe = Join-Path $LitellmVenvDir 'Scripts\litellm.exe'
$ConfigPath = Join-Path $Root 'litellm\config.yaml'
$EnvFile = Join-Path $Root '.env'
$StaticIndex = Join-Path $Root 'chat\static\index.html'
$FrontendDir = Join-Path $Root 'chat\frontend'
$CustomToolsDir = Join-Path $Root 'chat\custom_tools'
$ToolRuntimeVenv = Join-Path $Root 'chat\.tool_runtime_venv'

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Yellow
}

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        return
    }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) {
            return
        }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) {
            return
        }
        $name = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim()
        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        Set-Item -Path "Env:$name" -Value $value
    }
}

function Find-Python312 {
    $candidates = @(
        'py -3.12',
        'python3.12',
        'python'
    )
    foreach ($candidate in $candidates) {
        try {
            $parts = $candidate -split ' '
            if ($parts.Count -gt 1) {
                $version = & $parts[0] $parts[1] -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
            }
            else {
                $version = & $parts[0] -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
            }
            if ($version -eq '3.12') {
                return $candidate
            }
        }
        catch {
            continue
        }
    }
    return $null
}

function Invoke-VenvPython {
    param(
        [string]$VenvPython = $PythonExe,
        [Parameter(Mandatory = $true)][string[]]$PythonArgs
    )
    & $VenvPython @PythonArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: python $($PythonArgs -join ' ')"
    }
}

function Ensure-Venv {
    param(
        [string]$VenvPath,
        [string]$PythonLauncher
    )
    $venvPy = Join-Path $VenvPath 'Scripts\python.exe'
    if (Test-Path $venvPy) {
        return
    }
    Write-Ok "Creating $([IO.Path]::GetFileName($VenvPath))"
    if ($PythonLauncher -eq 'py -3.12') {
        & py -3.12 -m venv $VenvPath
    }
    else {
        & $PythonLauncher -m venv $VenvPath
    }
}

function Test-HttpReady([string]$Url, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Stop-PortListener([int]$Port) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "    Stopping $($proc.ProcessName) (PID $($proc.Id)) on port $Port" -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Stop-AdaServices {
    if (Test-Path $PidFile) {
        Get-Content $PidFile | ForEach-Object {
            $pidText = $_.Trim()
            if (-not $pidText) { return }
            $procId = [int]$pidText
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    # Orphaned listeners survive Ctrl+C if the pid file was lost; free Ada-SI ports.
    foreach ($port in @(8080, 8090, 4000, 5173)) {
        Stop-PortListener -Port $port
    }
}

function Start-AdaProcess {
    param(
        [string]$Name,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory = $Root,
        [hashtable]$Environment = @{},
        [string]$Executable = $PythonExe
    )

    $logPath = Join-Path $LogsDir "$Name.log"
    if (Test-Path $logPath) {
        Remove-Item $logPath -Force
    }

    $wd = $WorkingDirectory.Replace("'", "''")
    $bin = $Executable.Replace("'", "''")
    $log = $logPath.Replace("'", "''")
    $envPairs = @()
    foreach ($key in $Environment.Keys) {
        $escaped = ($Environment[$key].ToString()).Replace("'", "''")
        $envPairs += "`$env:$key = '$escaped';"
    }
    $escapedArgs = ($ArgumentList | ForEach-Object {
        "'" + $_.Replace("'", "''") + "'"
    }) -join ' '
    $command = @(
        "Set-Location -LiteralPath '$wd';"
        ($envPairs -join ' ')
        "& '$bin' $escapedArgs *>&1 | Tee-Object -FilePath '$log'"
    ) -join ' '

    $proc = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
        -PassThru `
        -WindowStyle Hidden

    Add-Content -Path $PidFile -Value $proc.Id
    return $proc
}

function Start-NodeProcess {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string[]]$ArgumentList
    )

    $logPath = Join-Path $LogsDir "$Name.log"
    if (Test-Path $logPath) {
        Remove-Item $logPath -Force
    }

    $wd = $WorkingDirectory.Replace("'", "''")
    $log = $logPath.Replace("'", "''")
    $escapedArgs = ($ArgumentList | ForEach-Object {
        "'" + $_.Replace("'", "''") + "'"
    }) -join ' '
    $command = @(
        "Set-Location -LiteralPath '$wd';"
        "& npm.cmd $escapedArgs *>&1 | Tee-Object -FilePath '$log'"
    ) -join ' '

    $proc = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
        -PassThru `
        -WindowStyle Hidden

    Add-Content -Path $PidFile -Value $proc.Id
    return $proc
}

Write-Host ""
Write-Host "Ada-SI native launcher" -ForegroundColor White

Write-Step "Checking prerequisites"
$pythonLauncher = Find-Python312
if (-not $pythonLauncher) {
    throw "Python 3.12 not found. Install from https://www.python.org/downloads/ and ensure py -3.12 works."
}
Write-Ok "Found Python 3.12 via: $pythonLauncher"

if (-not (Test-Path $ConfigPath)) {
    throw "Missing LiteLLM config at $ConfigPath"
}

if (-not (Test-Path $EnvFile)) {
    Write-Warn ".env not found - copy .env.example to .env and add your API keys."
    Write-Warn "Continuing with defaults; model calls will fail until keys are set."
}
else {
    Import-DotEnv $EnvFile
    Write-Ok "Loaded .env"
}

Write-Step "Preparing Python environment"
Ensure-Venv -VenvPath $VenvDir -PythonLauncher $pythonLauncher
Ensure-Venv -VenvPath $LitellmVenvDir -PythonLauncher $pythonLauncher
Write-Ok "Using app venv at .venv and LiteLLM venv at .venv-litellm"

Write-Ok "Installing/updating Python packages"
Invoke-VenvPython -PythonArgs @('-m', 'pip', 'install', '--upgrade', 'pip')
Invoke-VenvPython -PythonArgs @('-m', 'pip', 'install', '-r', (Join-Path $Root 'chat\requirements.txt'))
Invoke-VenvPython -PythonArgs @('-m', 'pip', 'install', '-r', (Join-Path $Root 'tool_runtime\requirements.txt'))

Invoke-VenvPython -VenvPython $LitellmPythonExe -PythonArgs @('-m', 'pip', 'install', '--upgrade', 'pip')
Invoke-VenvPython -VenvPython $LitellmPythonExe -PythonArgs @('-m', 'pip', 'install', 'litellm[proxy]')

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $CustomToolsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'chat\staging') | Out-Null

if (-not $SkipBuild -and -not $Dev) {
    Write-Step "Checking frontend build"
    $needsBuild = -not (Test-Path $StaticIndex)
    if ($needsBuild) {
        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npm) {
            throw "Node.js/npm not found. Install Node.js 22+ or run with -SkipBuild if static assets already exist."
        }
        Write-Ok "Installing frontend dependencies"
        Push-Location $FrontendDir
        try {
            npm ci
            Write-Ok "Building frontend into chat/static"
            npm run build
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Ok "Static frontend already present (chat/static/index.html)"
    }
}

if ($InstallOnly) {
    Write-Ok "Install complete. Run .\start.ps1 to start services."
    exit 0
}

Write-Step "Stopping any previous Ada-SI processes"
Stop-AdaServices
New-Item -ItemType File -Force -Path $PidFile | Out-Null

$sharedEnv = @{
    PYTHONUTF8             = '1'
    PYTHONIOENCODING       = 'utf-8'
    LITELLM_URL            = 'http://127.0.0.1:4000'
    TOOL_RUNTIME_URL       = 'http://127.0.0.1:8090'
    LITELLM_MASTER_KEY     = $(if ($env:LITELLM_MASTER_KEY) { $env:LITELLM_MASTER_KEY } else { 'sk-ada-dev-key' })
    LITE_MODEL             = $(if ($env:LITE_MODEL) { $env:LITE_MODEL } else { '' })
    TOOL_CREATOR_MODEL     = $(if ($env:TOOL_CREATOR_MODEL) { $env:TOOL_CREATOR_MODEL } else { '' })
    CHAT_MODEL             = $(if ($env:CHAT_MODEL) { $env:CHAT_MODEL } else { '' })
    SECOND_MODEL           = $(if ($env:SECOND_MODEL) { $env:SECOND_MODEL } else { '' })
    OPENAI_API_KEY         = $(if ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY } else { '' })
    ANTHROPIC_API_KEY      = $(if ($env:ANTHROPIC_API_KEY) { $env:ANTHROPIC_API_KEY } else { '' })
    GEMINI_API_KEY         = $(if ($env:GEMINI_API_KEY) { $env:GEMINI_API_KEY } else { '' })
    GROQ_API_KEY           = $(if ($env:GROQ_API_KEY) { $env:GROQ_API_KEY } else { '' })
    ADA_LOG_LEVEL          = $(if ($env:ADA_LOG_LEVEL) { $env:ADA_LOG_LEVEL } else { 'INFO' })
    ADA_LOG_MAX_BODY       = $(if ($env:ADA_LOG_MAX_BODY) { $env:ADA_LOG_MAX_BODY } else { '32000' })
    LITE_MODEL_REASONING_EFFORT = $(if ($env:LITE_MODEL_REASONING_EFFORT) { $env:LITE_MODEL_REASONING_EFFORT } else { 'low' })
}

Write-Step "Starting LiteLLM on http://127.0.0.1:4000"
if (-not (Test-Path $LitellmExe)) {
    throw "litellm.exe not found in .venv. Re-run with -InstallOnly."
}
Start-AdaProcess -Name 'litellm' -Executable $LitellmExe -ArgumentList @(
    "--config=$ConfigPath",
    '--port', '4000'
) -Environment $sharedEnv | Out-Null

if (-not (Test-HttpReady 'http://127.0.0.1:4000/health/liveliness')) {
    throw "LiteLLM did not become ready. Check logs\litellm.log"
}
Write-Ok "LiteLLM is ready"

$toolRuntimeEnv = $sharedEnv.Clone()
$toolRuntimeEnv.TOOLS_DIR = $CustomToolsDir
$toolRuntimeEnv.VENV_PATH = $ToolRuntimeVenv

Write-Step "Starting tool runtime on http://127.0.0.1:8090"
Start-AdaProcess -Name 'tool-runtime' -ArgumentList @(
    '-m', 'uvicorn', 'server:app',
    '--host', '127.0.0.1',
    '--port', '8090'
) -WorkingDirectory (Join-Path $Root 'tool_runtime') -Environment $toolRuntimeEnv | Out-Null

if (-not (Test-HttpReady 'http://127.0.0.1:8090/health')) {
    throw "Tool runtime did not become ready. Check logs\tool-runtime.log"
}
Write-Ok "Tool runtime is ready"

Write-Step "Starting chat server on http://127.0.0.1:8080"
Start-AdaProcess -Name 'chat' -ArgumentList @(
    '-m', 'uvicorn', 'app:app',
    '--host', '127.0.0.1',
    '--port', '8080'
) -WorkingDirectory (Join-Path $Root 'chat') -Environment $sharedEnv | Out-Null

if (-not (Test-HttpReady 'http://127.0.0.1:8080/api/config')) {
    throw "Chat server did not become ready. Check logs\chat.log"
}
Write-Ok "Chat server is ready"

$appUrl = 'http://127.0.0.1:8080'

if ($Dev) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw "Node.js/npm not found. Install Node.js 22+ or run without -Dev."
    }
    Write-Step "Starting Vite dev server on http://127.0.0.1:5173"
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Push-Location $FrontendDir
        try { npm ci } finally { Pop-Location }
    }
    Start-NodeProcess -Name 'frontend' -WorkingDirectory $FrontendDir -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173') | Out-Null
    if (-not (Test-HttpReady 'http://127.0.0.1:5173/' 60)) {
        throw "Vite dev server did not become ready. Check logs\frontend.log"
    }
    $appUrl = 'http://127.0.0.1:5173'
    Write-Ok "Vite dev server is ready"
}

Write-Host ""
Write-Host "Ada-SI is running." -ForegroundColor Green
Write-Host "  App:          $appUrl"
Write-Host "  Chat API:     http://127.0.0.1:8080/api/config"
Write-Host "  LiteLLM:      http://127.0.0.1:4000"
Write-Host "  Tool runtime: http://127.0.0.1:8090"
Write-Host "  Logs:         $LogsDir"
Write-Host ""
Write-Host "Press Ctrl+C to stop all services, or run .\stop.ps1 from another terminal."

if (-not $NoBrowser) {
    Start-Process $appUrl | Out-Null
}

try {
    while ($true) {
        Start-Sleep -Seconds 2
        if (-not (Test-Path $PidFile)) {
            break
        }
        $alive = $false
        foreach ($pidText in Get-Content $PidFile) {
            $procId = [int]$pidText.Trim()
            if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
                $alive = $true
                break
            }
        }
        if (-not $alive) {
            Write-Warn "All service processes exited. Check logs in $LogsDir"
            break
        }
    }
}
finally {
    Write-Step "Shutting down Ada-SI"
    Stop-AdaServices
    Write-Ok "Stopped"
}
