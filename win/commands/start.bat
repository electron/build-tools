@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" goto :no-config

cd "%ELECTRON_GN_ROOT%\src" || exit /B 1

call "out/%ELECTRON_OUT_DIR%/electron.exe" %*
if %errorlevel%=="1" goto :fail

exit /B 0

:no-config
echo You configuration has not been generated, please run "generate-config"
exit /B 1

:fail
exit /B 1