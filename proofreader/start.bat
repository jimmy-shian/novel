@echo off
setlocal
chcp 65001 > nul

:: ==========================================
:: CONFIGURATION  
:: ==========================================
::  cd /mnt/c/Users/user/Downloads/novel
set "WSL_DIR=/mnt/c/Users/user/Desktop/test_html/BioMistral_double"
set "WSL_MODEL=/mnt/c/Users/user/Downloads/novel/Model"
set "BACKEND_PY=C:\Users\user\venv\Scripts\python.exe"
set "BACKEND_DIR=%~dp0backend"

echo ------------------------------------------
echo NOVEL AI PROOFREADER - STARTER (v1.7)
echo ------------------------------------------

:: [1] Start HF Flask Server (Windows)
echo [1/3] Launching HF Transformers Server on Windows...
start "HF_SERVER_PROCESS" "%BACKEND_PY%" "%BACKEND_DIR%\llm_server_hf.py"

echo Waiting for model to load (approx. 3s)...
timeout /t 3 /nobreak > nul

:: [2] Start Backend
echo [2/3] Launching Backend...
start "BACKEND_PROCESS" /D "%BACKEND_DIR%" "%BACKEND_PY%" main.py

echo Waiting for services (5s)...
timeout /t 5 /nobreak > nul

:: [3] Start UI
echo [3/3] Opening Browser...
start "" "http://localhost:7788"

echo.
echo ==========================================
echo  SYSTEM IS READY
echo ==========================================
echo  To STOP everything, press ANY KEY here.
echo ------------------------------------------

pause

echo Stopping servers...

:: Cleanup Backend (Port 7788)
powershell -Command "Get-NetTCPConnection -LocalPort 7788 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

:: Cleanup HF Server (Port 8000)
powershell -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

taskkill /F /FI "WINDOWTITLE eq BACKEND_PROCESS*" /T > nul 2>&1
taskkill /F /FI "WINDOWTITLE eq HF_SERVER_PROCESS*" /T > nul 2>&1

echo Done.
timeout /t 2 > nul
exit