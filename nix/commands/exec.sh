#!/usr/bin/env bash

set -e

basedir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

source $basedir/__load-config.sh

if [ "$(uname)" == "Darwin" ]; then
  echo "$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/Electron.app/Contents/MacOS/Electron"
else
  echo "$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/electron"
fi
