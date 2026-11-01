@echo off
setlocal
cd /d "%~dp0"
set "CHENMENG_DATA_DIR=%~dp0.dev-data"
if not exist "release\ChenMeng-Launcher-0.1.1-portable.exe" goto missing
start "" "release\ChenMeng-Launcher-0.1.1-portable.exe"
exit /b
:missing
echo Packaged launcher missing. Run npm run pack first.
pause
