@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS, then run this file again.
  pause
  exit /b 1
)
node --env-file-if-exists=.env scripts/check-reader.mjs
if errorlevel 2 goto failed
if not errorlevel 1 goto running
if not exist node_modules\.bin\vite.cmd goto install
if not exist node_modules\.bin\tsc.cmd goto install
if not exist node_modules\mathjax-full\js\mathjax.js goto install
goto build
:install
echo Installing dependencies. Internet access is required the first time.
call npm ci
if errorlevel 1 goto failed
:build
echo Building Mosuan Reader...
call npm run build
if errorlevel 1 goto failed
echo.
echo Open the address printed below in your browser.
echo Keep this window open. Press Ctrl+C to stop the service.
call npm start
if errorlevel 1 goto failed
exit /b 0
:running
echo The existing service is ready. Use the address printed above.
pause
exit /b 0
:failed
echo.
echo Startup failed. See the error above. Close any other instance using port 3001.
pause
exit /b 1
