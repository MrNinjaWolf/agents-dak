@echo off
rem devkit launcher for Windows CMD and PowerShell: finds a working Python 3.
setlocal
set "DEVKIT_PY=%~dp0devkit.py"
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%DEVKIT_PY%" %*
  exit /b
)
python "%DEVKIT_PY%" %*
exit /b
