#Requires -Version 5.1
<#
.SYNOPSIS
  First-time native install for Ada-SI on Windows.

.DESCRIPTION
  Creates .env from .env.example, prepares runtime directories, and installs
  Python/Node dependencies via start.ps1 -InstallOnly.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$EnvExample = Join-Path $Root '.env.example'
$EnvFile = Join-Path $Root '.env'

Write-Host ""
Write-Host "Ada-SI native install" -ForegroundColor White
Write-Host ""

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
Write-Host "Installing dependencies..." -ForegroundColor Cyan
& (Join-Path $Root 'start.ps1') -InstallOnly
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Native install complete." -ForegroundColor Green
Write-Host "Next: edit .env if needed, then run .\start.bat or .\start.ps1"
Write-Host ""
