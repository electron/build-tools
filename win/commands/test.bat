@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" goto :no-config

cd "%ELECTRON_GN_ROOT%\src\electron" || exit /B 1

call node ./script/spec-runner.js electron/spec %*
if %errorlevel%=="1" goto :fail

exit /B 0

:no-config
echo You configuration has not been generated, please run "generate-config"
exit /B 1

:fail
exit /B 1