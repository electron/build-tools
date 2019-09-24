#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"
source "$basedir/__tools.sh"
ensure_node_modules

cd "$ELECTRON_GN_ROOT/src/electron"

ELECTRON_OUT_DIR="$ELECTRON_OUT_DIR" node ./script/node-spec-runner.js "$@"
