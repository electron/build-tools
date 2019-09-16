#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "${basedir}/__load-config.sh"

readonly dir=${1-electron}
echo "${ELECTRON_GN_ROOT}/src/${dir}"
