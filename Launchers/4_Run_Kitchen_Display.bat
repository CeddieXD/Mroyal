@echo off
title Mango Royal - Kitchen Display
cd /d "%~dp0.."
node tools\serve.js "%~dp0..\mango-royal-kitchen-lite" 5002 "Kitchen Display"
pause
