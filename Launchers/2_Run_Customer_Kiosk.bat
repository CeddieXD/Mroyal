@echo off
title Mango Royal - Customer Kiosk
cd /d "%~dp0.."
node tools\serve.js "%~dp0..\mango-royal-kiosk\public" 5000 "Customer Kiosk"
pause
