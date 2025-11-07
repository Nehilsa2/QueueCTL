@echo off
REM Enqueue sleep_fail.ps1 with 3 max_retries
queuectl enqueue "{\"command\":\"powershell -File sleep_fail.ps1\",\"max_retries\":3}"
