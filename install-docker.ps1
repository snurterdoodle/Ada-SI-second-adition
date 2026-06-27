#Requires -Version 5.1
<#
.SYNOPSIS
  First-time Docker install for Ada-SI.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$EnvExample = Join-Path $Root '.env.example'
$EnvFile = Join-Path $Root '.env'

Write-Host ""
Write-Host "Ada-SI Docker install" -ForegroundColor White
Write-Host ""

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}

try {
    docker compose version 2>$null | Out-Null
}
catch {
    throw "Docker Compose plugin not found. Ensure Docker Desktop is running."
}

if (-not (Test-Path $EnvFile)) {
    if (-not (Test-Path $EnvExample)) {
        throw "Missing .env.example at $EnvExample"
    }
    Copy-Item $EnvExample $EnvFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
    Write-Host "Edit .env and add your API keys before starting Ada-SI." -ForegroundColor Yellow
}
else {
    Write-Host ".env already exists" -ForegroundColor Green
}

$dirs = @(
    (Join-Path $Root 'chat\staging'),
    (Join-Path $Root 'chat\custom_tools'),
    (Join-Path $Root 'logs')
)
foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "Runtime directories ready" -ForegroundColor Green

Write-Host ""
Write-Host "Docker install complete." -ForegroundColor Green
Write-Host "Next: edit .env if needed, then run .\start-docker.bat or .\start-docker.ps1"
Write-Host ""
