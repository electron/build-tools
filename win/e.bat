@echo off

setlocal

set command=%1
set basedir=%~dp0

REM ignore first arg
shift
set args=%1
shift

:collect
if [%1] == [] goto parse-command
set args=%args% %1
shift
goto collect

:parse-command
if "%command%"=="" goto :missing-command
if "%command%"=="generate-config" goto :generate-config
if "%command%"=="sync" goto :sync
if "%command%"=="bootstrap" goto :bootstrap
if "%command%"=="build" goto :build
if "%command%"=="start" goto :start
if "%command%"=="test" goto :test

echo Unknown Electron Command: \"%1\"
exit /B 0

:missing-command
echo Usage: e [command] [...args]
echo You must provide a command, must be one of 'generate-config', 'sync', 'bootstrap', 'build', 'start' or 'test'
exit /B 0

:generate-config
call "%basedir%"\commands\generate-config.bat
exit /B %errorlevel%

:sync
call "%basedir%"\commands\sync.bat %args%
exit /B %errorlevel%

:bootstrap
call "%basedir%"\commands\bootstrap.bat
exit /B %errorlevel%

:build
call "%basedir%"\commands\build.bat %args%
exit /B %errorlevel%

:start
call "%basedir%"\commands\start.bat %args%
exit /B %errorlevel%

:test
call "%basedir%"\commands\test.bat %args%
exit /B %errorlevel%
