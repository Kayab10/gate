@echo off
cd /d "%~dp0"
rem If the tracker is already running, just open it.
netstat -ano | findstr /R /C:":5050 .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:5050
  exit /b
)
title GATE DA Tracker (close this window to stop)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5050"
node --no-warnings server.js
pause
