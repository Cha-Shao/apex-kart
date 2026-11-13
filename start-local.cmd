@echo off
setlocal
cd /d "%~dp0"
set "APEX_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "APEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Run pnpm install in this directory first.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5173"
"%APEX_NODE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort
pause
