#Requires -Version 5.1
<#
.SYNOPSIS
  Start Ada-SI via Docker Compose.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$EnvFile = Join-Path $Root '.env'

if (-not (Test-Path $EnvFile)) {
    throw "Missing .env — run .\install-docker.ps1 first"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw "Docker not found."
}

Write-Host ""
Write-Host "Starting Ada-SI (Docker)..." -ForegroundColor Cyan
Write-Host ""

Set-Location $Root
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed"
}

Write-Host ""
Write-Host "Ada-SI is running." -ForegroundColor Green
Write-Host "  App:  http://localhost:8080"
Write-Host "  Logs: docker compose logs -f"
Write-Host "  Stop: .\stop-docker.ps1"
Write-Host ""
