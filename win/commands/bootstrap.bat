@echo off

call __load-env.bat
if %errorlevel% gtr 0 exit /B %errorlevel%

echo Running "gn gen" in "%ELECTRON_GN_ROOT%\src"

cd "%ELECTRON_GN_ROOT%\src" || exit /B 1

REM sccache is not supported on windows yet, use this when supported
REM call gn gen "out/%ELECTRON_OUT_DIR%" --args="import(\"//electron/build/args/debug.gn\") cc_wrapper=\"%ELECTRON_GN_ROOT%/src/electron/external_binaries/sccache\""
call gn gen "out/%ELECTRON_OUT_DIR%" --args="import(\"//electron/build/args/debug.gn\")"
if %errorlevel%=="1" goto :fail

exit /B 0

:fail
exit /B 1
