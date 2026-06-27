@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-docker.ps1" %*
if errorlevel 1 (
  echo.
  echo Install failed. See messages above.
  pause
  exit /b 1
)
