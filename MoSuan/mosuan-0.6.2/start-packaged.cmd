@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS, then run this file again.
  pause
  exit /b 1
)
echo Open the local address shown below. Keep this window open while using Mosuan.
node --env-file-if-exists=.env server/index.js
if errorlevel 1 (
  pause
  exit /b 1
)
