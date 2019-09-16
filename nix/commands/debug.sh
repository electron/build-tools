#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

if [ "$(uname)" == "Darwin" ]; then
  lldb "$ELECTRON_EXEC"
else
  gdb "$ELECTRON_EXEC" -q -ex "source $ELECTRON_GN_ROOT/src/tools/gdb/gdbinit" $@
fi
