#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

cd $ELECTRON_GN_ROOT/src

if [ "$(uname)" == "Darwin" ]; then
  "./out/$ELECTRON_OUT_DIR/Electron.app/Contents/MacOS/Electron" "$@"
else
  "./out/$ELECTRON_OUT_DIR/electron" "$@"
fi
