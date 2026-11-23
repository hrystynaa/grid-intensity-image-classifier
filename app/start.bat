@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if exist "dist\index.html" goto open

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js не знайдено. Встановіть Node.js 22 або новіший з https://nodejs.org
  pause
  exit /b 1
)

echo Встановлення залежностей...
call npm ci
if errorlevel 1 goto failed

echo Збирання застосунку...
call npm run build
if errorlevel 1 goto failed

:open
start "" "dist\index.html"
exit /b 0

:failed
echo Не вдалося підготувати застосунок.
pause
exit /b 1
