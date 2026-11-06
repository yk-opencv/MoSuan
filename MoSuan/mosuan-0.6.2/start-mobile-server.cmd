@echo off
setlocal
cd /d "%~dp0"
set "HOST=0.0.0.0"
echo Start the LAN service for your Android app.
echo If another Mosuan server is running, stop it with Ctrl+C first.
echo Open http://127.0.0.1:3001 on this PC, then Settings - API - Android pairing.
call start-reader.cmd
