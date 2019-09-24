@echo off

setlocal

call %~dp0\..\common\switch.js %1
exit /B %errorlevel%
