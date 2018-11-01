@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" goto :no-config

echo Running "gn gen" in "%ELECTRON_GN_ROOT%\src"

cd "%ELECTRON_GN_ROOT%\src" || exit /B 1

REM sccache is not supported on windows yet, use this when supported
REM call gn gen "out/%ELECTRON_OUT_DIR%" --args="import(\"//electron/build/args/debug.gn\") cc_wrapper=\"%ELECTRON_GN_ROOT%/src/electron/external_binaries/sccache\""
call gn gen "out/%ELECTRON_OUT_DIR%" --args="import(\"//electron/build/args/debug.gn\")"
if %errorlevel%=="1" goto :fail

exit /B 0

:no-config
echo You configuration has not been generated, please run "generate-config"
exit /B 1

:fail
exit /B 1