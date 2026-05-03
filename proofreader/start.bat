@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

:: ==========================================
:: CONFIGURATION  
:: ==========================================
:: How many servers to run PER KEY (Total = 3 * NUM_PER_KEY)
set "NUM_PER_KEY=2"
set "START_PORT=8000"

set "BACKEND_PY=C:\Users\user\venv\Scripts\python.exe"
set "BACKEND_DIR=%~dp0backend"

echo ------------------------------------------
echo NOVEL AI PROOFREADER - STARTER (v1.8)
echo ------------------------------------------

:: [1] Start HF Flask Servers (Windows)
echo [1/3] Launching HF Transformers Servers...

:: Load keys from .env
for /f "usebackq eol=# tokens=1,2 delims==" %%a in ("backend\.env") do (
    set "val=%%~b"
    :: Trim leading/trailing spaces by using another for
    for /f "tokens=1" %%k in ("!val!") do set "val=%%k"
    
    if "%%a"=="API_KEY_1" set "KEY1=!val!"
    if "%%a"=="API_KEY_2" set "KEY2=!val!"
    if "%%a"=="API_KEY_3" set "KEY3=!val!"
)

set "VLLM_BASE_URLS="
set /a "TOTAL_SERVERS=3 * %NUM_PER_KEY%"
set /a "END_PORT=%START_PORT% + %TOTAL_SERVERS% - 1"

echo Dynamic Mode: %TOTAL_SERVERS% servers total (%NUM_PER_KEY% per key)

:: Loop to start servers
for /L %%I in (1,1,%TOTAL_SERVERS%) do (
    set /a "CUR_IDX=%%I - 1"
    set /a "CUR_PORT=%START_PORT% + !CUR_IDX!"
    
    :: Determine which key to use
    set /a "KEY_IDX=!CUR_IDX! / %NUM_PER_KEY%"
    if !KEY_IDX! equ 0 set "CUR_KEY=!KEY1!"
    if !KEY_IDX! equ 1 set "CUR_KEY=!KEY2!"
    if !KEY_IDX! equ 2 set "CUR_KEY=!KEY3!"
    
    set "LLM_SERVER_PORT=!CUR_PORT!"
    set "OVER_API_KEY=!CUR_KEY!"
    set "OVERRIDE_API_KEY=!CUR_KEY!"
    
    start "HF_SERVER_!CUR_PORT!" "%BACKEND_PY%" "%BACKEND_DIR%\llm_server_hf.py"
    
    if defined VLLM_BASE_URLS (
        set "VLLM_BASE_URLS=!VLLM_BASE_URLS!,http://127.0.0.1:!CUR_PORT!/v1"
    ) else (
        set "VLLM_BASE_URLS=http://127.0.0.1:!CUR_PORT!/v1"
    )
)

:: Set concurrency: roughly 1 requests per server to respect PRM 40
set /a "LLM_MAX_CONCURRENCY=%TOTAL_SERVERS% * 1"

echo Waiting for models to load (1s)...
timeout /t 1 /nobreak > nul

:: [2] Start Backend
echo [2/3] Launching Backend...
start "BACKEND_PROCESS" /D "%BACKEND_DIR%" "%BACKEND_PY%" main.py

echo Waiting for services (8s)...
timeout /t 8 /nobreak > nul

:: [3] Start UI
echo [3/3] Opening Browser...
start "" "http://localhost:7788"

echo.
echo ==========================================
echo  SYSTEM IS READY (%TOTAL_SERVERS%-Server / 3-Key Mode)
echo ==========================================
echo  To STOP everything, press ANY KEY here.
echo ------------------------------------------

pause

echo Stopping servers...

:: Cleanup Backend (Port 7788)
powershell -Command "Get-NetTCPConnection -LocalPort 7788 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

:: Cleanup HF Servers (Ports START_PORT to END_PORT)
powershell -Command "%START_PORT%..%END_PORT% | ForEach-Object { Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

taskkill /F /FI "WINDOWTITLE eq BACKEND_PROCESS*" /T > nul 2>&1
taskkill /F /FI "WINDOWTITLE eq HF_SERVER_*" /T > nul 2>&1

echo Done.
timeout /t 2 > nul
exit