@echo off
cd /d "%~dp0"
python sim.py -n 50 %*
pause
