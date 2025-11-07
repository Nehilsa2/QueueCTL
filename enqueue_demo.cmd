@echo off
REM Enqueue retry_demo.ps1 with 3 max_retries
queuectl enqueue "{\"command\":\"powershell -File retry_demo.ps1\",\"max_retries\":3}"