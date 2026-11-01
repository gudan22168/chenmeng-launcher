@echo off
setlocal
cd /d "%~dp0"
where pwsh >nul 2>nul
if errorlevel 1 goto windowsps
pwsh -NoProfile -File "%~dp0scripts\play-current.ps1"
goto done
:windowsps
powershell -NoProfile -File "%~dp0scripts\play-current.ps1"
:done
if errorlevel 1 pause
