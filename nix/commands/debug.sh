#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

if [ "$(uname)" == "Darwin" ]; then
  lldb "$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/Electron.app/Contents/MacOS/Electron"
else
  gdb "$ELECTRON_GN_ROOT/src/out/$ELECTRON_OUT_DIR/electron" -q -ex "source $ELECTRON_GN_ROOT/src/tools/gdb/gdbinit" $@
fi
