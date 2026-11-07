@echo off
chcp 65001 >nul
title TikTok Music Clean - Server
echo ========================================================
echo   Dang khoi dong TikTok Music Clean tai http://localhost:10000
echo ========================================================
if not exist node_modules (
    echo Dang cai dat thu vien npm...
    call npm install
)
start http://localhost:10000
node server.js
pause
