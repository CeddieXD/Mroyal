@echo off
setlocal
title "Mango Royal - Shared Backend & Database"
cd /d "%~dp0.."
echo ====================================================
echo   Mango Royal - Shared Backend ^& Database (Port 3000)
echo ====================================================
set "NODE_PATH=%~dp0..\mango-royal-kiosk\mango-royal-backend\node_modules"
start "Mango Royal Printer Server" /D "%~dp0..\mango-royal-printer-server" cmd /k "npm start"
node tools\check-db.js
cd /d "%~dp0..\mango-royal-kiosk\mango-royal-backend"
npm start
pause
endlocal
