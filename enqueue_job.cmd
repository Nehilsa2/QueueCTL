@echo off
queuectl enqueue "{\"command\":\"powershell -File retry_test.ps1\",\"max_retries\":3}"