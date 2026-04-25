@echo off
start "AI Map Assistant" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start http://localhost:8080
