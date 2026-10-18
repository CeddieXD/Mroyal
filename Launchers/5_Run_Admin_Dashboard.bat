@echo off
title Mango Royal - Admin Dashboard
cd /d "%~dp0.."
node tools\serve.js "%~dp0..\Admin Dashboard Interface (2)" 5003 "Admin Dashboard"
pause
