@echo off
title Mango Royal - Cashier POS
cd /d "%~dp0.."
node tools\serve.js "%~dp0..\mango-royal-pos-lite" 5001 "Cashier POS"
pause
