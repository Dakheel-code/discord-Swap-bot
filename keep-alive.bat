@echo off
title Discord Bot - Auto Restart
echo Discord Bot Auto-Restart Script
echo ================================
echo.
echo This script will automatically restart the bot if it crashes.
echo Press Ctrl+C to stop completely.
echo.

:start
echo [%date% %time%] Starting bot...
node src/index.js
echo.
echo [%date% %time%] Bot stopped! Restarting in 5 seconds...
timeout /t 5 /nobreak
goto start
