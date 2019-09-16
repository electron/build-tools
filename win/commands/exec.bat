@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" goto :no-config

echo "%ELECTRON_GN_ROOT%/src/out/%ELECTRON_OUT_DIR%/electron.exe" %*

exit /B 0

:no-config
echo You configuration has not been generated, please run "generate-config"
exit /B 1
