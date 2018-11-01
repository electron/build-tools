@echo off

call node "%~dp0"/../../common/generate-config.js
if %errorlevel%=="1" goto :fail

echo Config parsed and generated successfully
exit /B 0

:fail
exit /B 1