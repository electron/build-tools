#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

if [ "$(uname)" == "Darwin" ]; then
  "$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/Electron.app/Contents/MacOS/Electron" "$@"
else
  "$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/electron" "$@"
fi
