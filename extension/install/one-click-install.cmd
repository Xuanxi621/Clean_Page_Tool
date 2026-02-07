@echo off
setlocal

set "ROOT="
set "CANDIDATES=%USERPROFILE%\Desktop\Clean_Page_Tool;%USERPROFILE%\Documents\Clean_Page_Tool;%USERPROFILE%\Downloads\Clean_Page_Tool"

for %%P in (%CANDIDATES%) do (
  if exist "%%P\native-host\auto-install.ps1" set "ROOT=%%P"
)

if not defined ROOT (
  echo Clean_Page_Tool not found in common locations.
  echo Enter project path (example: C:\Users\%USERNAME%\Desktop\Clean_Page_Tool):
  set /p ROOT=
)

if not exist "%ROOT%\native-host\auto-install.ps1" (
  echo auto-install.ps1 not found under: %ROOT%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\native-host\auto-install.ps1" -Browser both
pause
