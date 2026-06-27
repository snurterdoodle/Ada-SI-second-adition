#Requires -Version 5.1
<#
.SYNOPSIS
  Stop Ada-SI Docker services.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot

Write-Host "Stopping Ada-SI (Docker)..."
Set-Location $Root
docker compose down
if ($LASTEXITCODE -ne 0) {
    throw "docker compose down failed"
}
Write-Host "Done."
