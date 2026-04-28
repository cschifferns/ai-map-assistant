@echo off
start "AI Map Assistant" powershell -NoExit -ExecutionPolicy Bypass -Command "$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH; cd '%~dp0'; npm run dev"
timeout /t 3 /nobreak >nul
start https://localhost:8080
