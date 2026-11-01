@echo off
setlocal
cd /d "%~dp0"
set "CHENMENG_DATA_DIR=%~dp0.dev-data"
if not exist "dist\index.html" goto missing
if not exist "node_modules\electron\dist\electron.exe" goto missing
start "" "node_modules\electron\dist\electron.exe" "."
exit /b
:missing
echo Launcher files missing. Run npm install and npm run build in this folder.
pause
