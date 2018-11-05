#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

cd $ELECTRON_GN_ROOT/src/electron

node ./script/spec-runner.js electron/spec "$@"
