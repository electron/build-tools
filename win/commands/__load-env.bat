if "%ELECTRON_BUILD_TOOLS_CONFIG%" == "" (
  set envbat=%~dp0..\..\generated.env.bat
) else (
  set envbat=%ELECTRON_BUILD_TOOLS_CONFIG%\generated.env.bat
)

if exist %envbat% (
  call %envbat%
) else (
  echo %envbat% not found! Do you need to run 'e fetch'?
  exit /B 1
)

