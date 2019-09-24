@echo off

call __load-env.bat
if %errorlevel% gtr 0 exit /B %errorlevel%

cd "%ELECTRON_GN_ROOT%\src\electron" || exit /B 1

call node ./script/spec-runner.js electron/spec %*
if %errorlevel%=="1" goto :fail

exit /B 0

:fail
exit /B 1
