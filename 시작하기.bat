@echo off
REM Korean only in the filename. Content is ASCII. Calls start.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
