@echo off
setlocal
cd /d "%~dp0"
call npm test
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
node node_modules\electron-builder\cli.js --win portable --x64 --config.electronDist=node_modules/electron/dist --publish never
if errorlevel 1 goto failed
echo Built: release\ChenMeng-Launcher-*-portable.exe
pause
exit /b 0
:failed
echo Build failed. Please copy the error above.
pause
exit /b 1
