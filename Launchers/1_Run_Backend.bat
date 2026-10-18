@echo off
title Mango Royal - Shared Backend & Database
cd /d "%~dp0.."
echo ====================================================
echo   Mango Royal - Shared Backend & Database (Port 3000)
echo ====================================================
set NODE_PATH=mango-royal-kiosk\mango-royal-backend\node_modules
node tools\check-db.js
cd /d "%~dp0..\mango-royal-kiosk\mango-royal-backend"
node server.js
pause
