@echo off
title Roundup Automator
color 0A

cd /d "%~dp0"

echo ========================================
echo    Roundup Automator
echo ========================================
echo.

:: Check Node.js
node --version >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] Node.js not found!
    echo     Download and install from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Install npm dependencies if needed
if not exist "node_modules" (
    echo [i] First time setup - installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [X] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo.
)

:: Install Playwright Chromium browser if needed
if not exist "%LOCALAPPDATA%\ms-playwright\chromium-*" (
    echo [i] Installing Chromium browser for automation...
    npx playwright install chromium
    if %errorlevel% neq 0 (
        echo [X] Failed to install Chromium.
        pause
        exit /b 1
    )
    echo.
)

:: First-time secrets setup
if not exist "config\secrets.json" (
    echo [i] First time setup - copying config\secrets.example.json to config\secrets.json
    copy "config\secrets.example.json" "config\secrets.json" >nul
    echo [!] Edit config\secrets.json and fill in your PinClicks / Gemini keys before scanning.
    echo.
)

:: Create required directories
if not exist "data" mkdir data

echo [OK] All dependencies ready!
echo.
echo Starting Roundup Automator on http://localhost:3100
echo.
echo DO NOT CLOSE THIS WINDOW
echo ========================================
echo.

:: Open dashboard in default browser
start "" "http://localhost:3100"

:: Start the server (auto-restart loop so the in-app "Update Now" button works)
:startloop
node src/server.js
echo.
echo [i] App stopped. Restarting in 3 seconds... (Ctrl+C to quit)
timeout /t 3 /nobreak >nul
goto startloop
