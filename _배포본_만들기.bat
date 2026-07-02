@echo off
REM Korean only in filename. Content ASCII. Calls make_package.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make_package.ps1"
pause
