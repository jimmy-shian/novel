@echo off
setlocal
chcp 65001 > nul

:: ==========================================
:: CONFIGURATION
:: ==========================================
set "WSL_DIR=/mnt/c/Users/user/Desktop/test_html/BioMistral_double"
set "WSL_MODEL=/mnt/c/Users/user/Downloads/novel/Model"
set "BACKEND_PY=C:\Users\user\venv\Scripts\python.exe"
set "BACKEND_DIR=%~dp0backend"

echo ------------------------------------------
echo NOVEL AI PROOFREADER - STARTER (v1.7)
echo ------------------------------------------

:: [1] Start vLLM in WSL
echo [1/3] Launching vLLM in WSL...
start "VLLM_PROCESS" wsl sh -c "cd %WSL_DIR% && . .venv/bin/activate && python3 -m vllm.entrypoints.openai.api_server --model %WSL_MODEL% --served-model-name gptoss20b --port 8000 --max-model-len 8192 --trust-remote-code --dtype float16"

echo Waiting for model (20s)...
timeout /t 2 /nobreak > nul

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

:: Cleanup Backend (Windows)
powershell -Command "Get-NetTCPConnection -LocalPort 7788 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
taskkill /F /FI "WINDOWTITLE eq BACKEND_PROCESS*" /T > nul 2>&1

:: Cleanup vLLM (WSL)
wsl pkill -f vllm
taskkill /F /FI "WINDOWTITLE eq VLLM_PROCESS*" /T > nul 2>&1

echo Done.
timeout /t 2 > nul
exit