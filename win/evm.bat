@echo off

setlocal

set basedir=%~dp0

call "%basedir%"\..\common\switch.js %1
exit /B %errorlevel%
