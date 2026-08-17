@echo off
rem Minimal stand-in for depot_tools' `gclient`, used by tests that aren't
rem exercising the real depot_tools bootstrap (see tests/sandbox.js).
if "%1"=="config" (
  echo solutions = [] > .gclient
)
exit /b 0
