#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

if [[ "$OSTYPE" = "linux-gnu" ]]; then
  gdb "$ELECTRON_EXEC" -q -ex "source $ELECTRON_GN_ROOT/src/tools/gdb/gdbinit" $@
else
  lldb "$ELECTRON_EXEC"
fi
