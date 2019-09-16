@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" goto :no-config

IF [%1]==[] (set src_child=electron) ELSE (set src_child=%1)
echo "%ELECTRON_GN_ROOT%/src/%src_child%"

exit /B 0

:no-config
echo You configuration has not been generated, please run "generate-config"
exit /B 1
