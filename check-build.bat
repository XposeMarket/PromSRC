@echo off
cd /d D:\Prometheus
call npm run build > build-output.txt 2>&1
echo Exit code: %ERRORLEVEL% >> build-output.txt
type build-output.txt
