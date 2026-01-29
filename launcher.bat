@echo off
REM Launch Sandbox Project GPT (Windows)
setlocal

REM Change to the directory where this script is located
cd /d %~dp0

REM Start backend + frontend
python launcher.py

endlocal
