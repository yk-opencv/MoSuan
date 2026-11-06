@echo off
setlocal
cd /d "%~dp0"
title Mosuan - DeepSeek Web Login
node scripts/web-proxy.mjs login
echo.
echo Login finished. If successful, run start-web-proxy.cmd next.
pause
