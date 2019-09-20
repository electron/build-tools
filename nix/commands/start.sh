#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"

"$ELECTRON_EXEC" "$@"
