#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

echo Running \"gn gen\" in \"$ELECTRON_GN_ROOT/src\"
cd $ELECTRON_GN_ROOT/src

gn gen "out/$ELECTRON_OUT_DIR" --args="import(\"//electron/build/args/debug.gn\") cc_wrapper=\"$ELECTRON_GN_ROOT/src/electron/external_binaries/sccache\""
