@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" (
  echo Your configuration has not been generated. Please run "generate-config"
  exit /B 1
)

SET CMD=%1

if "%2"=="" (
  SET SRC=electron
) else (
  SET SRC=%2
)

if /i "%CMD%"=="exe" (
  echo | set /p dummyName=%ELECTRON_GN_ROOT%/src/out/%ELECTRON_OUT_DIR%/electron.exe
) else if /i "%CMD%"=="out" (
  echo | set /p dummyName=%ELECTRON_OUT_DIR%
) else if /i "%CMD%"=="src" (
  echo | set /p dummyName=%ELECTRON_GN_ROOT%/src/%SRC%
) else (
  echo Usage: e show {exe ^| out ^| src [name]}
  echo exe: the path to built Electron executable
  echo out: the outdir, e.g. "Testing"
  echo src: the path to the "name" [default:electron] source directory, e.g. "/path/to/electron/src/electron"
)
