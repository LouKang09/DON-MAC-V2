@echo off
setlocal
cd /d "%~dp0"
title Coffee POS Web - Full Check
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js was not found.
  echo Install Node.js 22.5 or newer, then run this file again.
  echo.
  pause
  exit /b 1
)
echo ============================================================
echo  Coffee POS Web - Validation
 echo ============================================================
echo Running the complete API/database regression suite...
echo.
node --no-warnings scripts\smoke-test.js
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  VALIDATION FAILED
  echo ============================================================
  echo Read the error above before using the POS for live sales.
  echo.
  pause
  exit /b 1
)
echo.
echo Checking the Transaction Audit View...
node scripts\audit-view-test.js
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  TRANSACTION AUDIT VIEW CHECK FAILED
  echo ============================================================
  echo.
  pause
  exit /b 1
)
echo.
echo Checking product availability tooltips and recipe gating...
node scripts\availability-test.js
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  PRODUCT AVAILABILITY CHECK FAILED
  echo ============================================================
  echo.
  pause
  exit /b 1
)
echo.
echo ============================================================
echo  ALL AUTOMATED CHECKS PASSED
 echo ============================================================
echo.
pause
exit /b 0
