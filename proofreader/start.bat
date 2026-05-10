@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

:: ==========================================
:: CONFIGURATION
:: ==========================================

:: How many servers to run PER KEY
set "NUM_PER_KEY=4"

:: Total API keys
set "TOTAL_KEYS=4"

:: Starting port
set "START_PORT=8000"

set "BACKEND_PY=C:\Users\user\venv\Scripts\python.exe"
set "BACKEND_DIR=%~dp0backend"

echo ------------------------------------------
echo NOVEL AI PROOFREADER - STARTER (v2.0)
echo ------------------------------------------

:: ==========================================
:: [1] Load API Keys
:: ==========================================

echo [1/3] Loading API Keys...

for /f "usebackq eol=# tokens=1,2 delims==" %%a in ("backend\.env") do (
    set "val=%%~b"

    :: Trim spaces
    for /f "tokens=1" %%k in ("!val!") do set "val=%%k"

    if "%%a"=="API_KEY_1" set "KEY1=!val!"
    if "%%a"=="API_KEY_2" set "KEY2=!val!"
    if "%%a"=="API_KEY_3" set "KEY3=!val!"
    if "%%a"=="API_KEY_4" set "KEY4=!val!"
    if "%%a"=="API_KEY_5" set "KEY5=!val!"
    if "%%a"=="API_KEY_6" set "KEY6=!val!"
    if "%%a"=="API_KEY_7" set "KEY7=!val!"
    if "%%a"=="API_KEY_8" set "KEY8=!val!"
)

:: ==========================================
:: [2] Launch HF Servers
:: ==========================================

echo [2/3] Launching HF Transformers Servers...

set "VLLM_BASE_URLS="

set /a "TOTAL_SERVERS=%TOTAL_KEYS% * %NUM_PER_KEY%"
set /a "END_PORT=%START_PORT% + %TOTAL_SERVERS% - 1"

echo.
echo Keys            : %TOTAL_KEYS%
echo Servers per Key : %NUM_PER_KEY%
echo Total Servers   : %TOTAL_SERVERS%
echo Port Range      : %START_PORT% - %END_PORT%
echo.

:: Loop count fix
set /a "LAST_SERVER_IDX=%TOTAL_SERVERS% - 1"

:: Loop to start servers
for /L %%I in (0,1,%LAST_SERVER_IDX%) do (

    set /a "CUR_PORT=%START_PORT% + %%I"

    :: Which API key group
    set /a "KEY_IDX=%%I / %NUM_PER_KEY% + 1"

    :: Dynamic variable lookup
    call set "CUR_KEY=%%KEY!KEY_IDX!%%"

    echo Launching Server Port !CUR_PORT! using KEY!KEY_IDX!

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

:: ==========================================
:: Concurrency
:: ==========================================

:: Safer concurrency (2x servers) to avoid hitting 40 RPM limit too fast
set /a "LLM_MAX_CONCURRENCY=%TOTAL_SERVERS% * 1"

echo.
echo Waiting for models to load (3s)...
timeout /t 3 /nobreak > nul

:: ==========================================
:: [3] Launch Backend
:: ==========================================

echo [3/3] Launching Backend...

start "BACKEND_PROCESS" /D "%BACKEND_DIR%" "%BACKEND_PY%" main.py

echo Waiting for backend (8s)...
timeout /t 8 /nobreak > nul

:: ==========================================
:: Open UI
:: ==========================================

echo Opening Browser...
start "" "http://localhost:7788"

echo.
echo ==========================================
echo  SYSTEM IS READY
echo ==========================================
echo  Keys            : %TOTAL_KEYS%
echo  Servers per Key : %NUM_PER_KEY%
echo  Total Servers   : %TOTAL_SERVERS%
echo ==========================================
echo.
echo To STOP everything, press ANY KEY here.
echo ------------------------------------------

pause

:: ==========================================
:: Cleanup
:: ==========================================

echo.
echo Stopping servers...

:: Cleanup Backend
powershell -Command ^
"Get-NetTCPConnection -LocalPort 7788 -ErrorAction SilentlyContinue ^| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

:: Cleanup HF Servers
powershell -Command ^
"%START_PORT%..%END_PORT% ^| ForEach-Object { Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue ^| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

taskkill /F /FI "WINDOWTITLE eq BACKEND_PROCESS*" /T > nul 2>&1
taskkill /F /FI "WINDOWTITLE eq HF_SERVER_*" /T > nul 2>&1

echo Done.
timeout /t 2 > nul
exit