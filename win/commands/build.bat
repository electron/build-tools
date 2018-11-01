@echo off

call "%~dp0"\..\..\generated.env.bat
if %errorlevel%=="1" goto :no-config

cd "%ELECTRON_GN_ROOT%\src" || exit /B 1

set command=%1

if "%command%"=="" goto :target-electron
if "%command%"=="electron" goto :target-electron
if "%command%"=="electron:dist" goto :target-electron-dist
if "%command%"=="mksnapshot" goto :target-mksnapshot
if "%command%"=="chromedriver" goto :target-chromedriver
if "%command%"=="node:headers" goto :target-node-headers
if "%command%"=="breakpad" goto :target-breakpad
goto :bad-arg

:target-electron
set target=electron
goto :ninja

:target-electron-dist
set target=electron:electron_dist_zip
goto :ninja

:target-mksnapshot
set target=electron:electron_mksnapshot_zip
goto :ninja

:target-chromedriver
set target=electron:electron_chromedriver_zip
goto :ninja

:target-node-headers
set target=third_party/electron_node:headers
goto :ninja

:target-breakpad
set target=third_party/breakpad:dump_syms
goto :ninja

:ninja
echo Running "ninja" in "%ELECTRON_GN_ROOT%\src" with target "%target%"
call ninja -C "out/%ELECTRON_OUT_DIR%" %target%
if %errorlevel%=="1" goto :fail
exit /B 0

:bad-arg
echo Unknown build target "%command%", please check the README for possible targets
exit /B 1

:no-config
echo You configuration has not been generated, please run "generate-config"
exit /B 1

:fail
exit /B 1