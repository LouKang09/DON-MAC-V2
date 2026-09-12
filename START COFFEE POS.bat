@echo off
setlocal
cd /d "%~dp0"
title Coffee POS Web
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js was not found.
  echo Install Node.js 22.5 or newer, then run this file again.
  echo.
  pause
  exit /b 1
)
node scripts\start-pos.js
if errorlevel 1 (
  echo.
  echo Coffee POS could not start. Read the error above.
  pause
)
endlocal
