#!/usr/bin/env bash

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

config_path="${ELECTRON_BUILD_TOOLS_CONFIG-"$basedir/../.."}/generated.env.sh"
if [[ ! -f "$config_path" ]]; then
  echo "Configuration '$config_path' not found. (Do you need to run 'evm' or 'e fetch'?)"
  exit 1
fi
source "$config_path"
unset config_path

declare ELECTRON_EXEC
if [[ "$OSTYPE" = "linux-gnu" ]]; then
  ELECTRON_EXEC="$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/electron"
else
  ELECTRON_EXEC="$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/Electron.app/Contents/MacOS/Electron"
fi

