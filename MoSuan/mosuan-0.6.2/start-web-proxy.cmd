@echo off
setlocal
cd /d "%~dp0"
title Mosuan - DeepSeek Web Proxy
node scripts/web-proxy.mjs start
echo.
echo Proxy stopped. See messages above if startup failed.
pause
