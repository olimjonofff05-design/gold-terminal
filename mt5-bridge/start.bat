@echo off
chcp 65001 >nul
title AURUM MT5 ko'prigi
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python topilmadi. https://www.python.org/downloads/ dan o'rnating va "Add python.exe to PATH" ni belgilang.
  pause
  exit /b 1
)
python -c "import MetaTrader5" 2>nul || (
  echo MetaTrader5 kutubxonasi o'rnatilmoqda...
  python -m pip install --upgrade MetaTrader5
)
python aurum_bridge.py %*
pause
