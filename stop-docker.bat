@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-docker.ps1" %*
if errorlevel 1 (
  echo.
  echo Stop failed. See messages above.
  pause
  exit /b 1
)
