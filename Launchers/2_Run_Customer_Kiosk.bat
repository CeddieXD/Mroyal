@echo off
title Mango Royal - Customer Kiosk
cd /d "%~dp0.."
set LIVE_RELOAD=1
node tools\serve.js "%~dp0..\mango-royal-kiosk\public" 5000 "Customer Kiosk"
pause
