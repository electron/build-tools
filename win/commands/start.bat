@echo off

call __load-env.bat
if %errorlevel% gtr 0 exit /B %errorlevel%

cd "%ELECTRON_GN_ROOT%\src" || exit /B 1

call "out/%ELECTRON_OUT_DIR%/electron.exe" %*
if %errorlevel%=="1" goto :fail

exit /B 0

:fail
exit /B 1
