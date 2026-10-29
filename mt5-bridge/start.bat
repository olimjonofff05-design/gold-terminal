@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title AURUM MT5 ko'prigi
cd /d "%~dp0"

echo ========================================================
echo   AURUM - MT5 ko'prigi
echo ========================================================

rem ---------- 1. Python ----------
set "PY="
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" "%ProgramFiles%\Python312\python.exe") do (
  if not defined PY if exist %%P set PY="%%~P"
)
if not defined PY (
  where py >nul 2>nul && (py -3 -c "import sys" >nul 2>nul && set "PY=py -3")
)
if not defined PY (
  where python >nul 2>nul && (python -c "import sys; assert sys.version_info>=(3,8)" >nul 2>nul && set "PY=python")
)
if not defined PY (
  echo [1/3] Python topilmadi - winget orqali Python 3.12 o'rnatilmoqda...
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not defined PY (
  echo XATO: Python o'rnatilmadi. https://www.python.org/downloads/ dan qo'lda o'rnating.
  pause
  exit /b 1
)
echo [1/3] Python: !PY!

rem ---------- 2. MetaTrader 5 ----------
set "MT5="
for %%M in ("%ProgramFiles%\MetaTrader 5 EXNESS\terminal64.exe" "%ProgramFiles%\MetaTrader 5\terminal64.exe" "%ProgramFiles%\Exness MetaTrader 5\terminal64.exe") do (
  if not defined MT5 if exist %%M set "MT5=%%~M"
)
if not defined MT5 (
  for /d %%D in ("%ProgramFiles%\*MetaTrader*" "%ProgramFiles%\*MT5*") do (
    if not defined MT5 if exist "%%~D\terminal64.exe" set "MT5=%%~D\terminal64.exe"
  )
)
if not defined MT5 (
  echo [2/3] MetaTrader 5 topilmadi - rasmiy o'rnatuvchi yuklanmoqda ^(download.mql5.com^)...
  curl -L --fail -o "%TEMP%\mt5setup.exe" "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe"
  if exist "%TEMP%\mt5setup.exe" (
    echo       O'rnatuvchi ochiladi - oynadagi ko'rsatmalarga amal qiling.
    start /wait "" "%TEMP%\mt5setup.exe"
  )
  if exist "%ProgramFiles%\MetaTrader 5\terminal64.exe" set "MT5=%ProgramFiles%\MetaTrader 5\terminal64.exe"
)
if defined MT5 (
  echo [2/3] MetaTrader 5: !MT5!
  tasklist /FI "IMAGENAME eq terminal64.exe" | find /I "terminal64.exe" >nul || (
    echo       MT5 ochilmoqda... Exness hisobingizga kiring: Fayl - Savdo hisobiga kirish, serverni qidiruvda "Exness" deb yozing.
    start "" "!MT5!"
  )
) else (
  echo [2/3] DIQQAT: MetaTrader 5 topilmadi. Exness kabinetidan MT5 ni o'rnating.
)

rem ---------- 3. Kutubxona va ko'prik ----------
!PY! -c "import MetaTrader5" >nul 2>nul || (
  echo [3/3] MetaTrader5 kutubxonasi o'rnatilmoqda...
  !PY! -m pip install --disable-pip-version-check --upgrade MetaTrader5
)
echo [3/3] Ko'prik ishga tushmoqda...
echo.
if defined MT5 (
  !PY! aurum_bridge.py --path "!MT5!" %*
) else (
  !PY! aurum_bridge.py %*
)
pause
