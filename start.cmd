@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 24.14 or a later Node.js 24 release first.
  pause
  exit /b 1
)
node server/index.js --open
if errorlevel 1 pause
