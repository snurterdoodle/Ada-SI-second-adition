@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-docker.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Run: docker compose logs
  pause
  exit /b 1
)
