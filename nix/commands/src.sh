#!/usr/bin/env bash

set -e

basedir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source "${basedir}/__load-config.sh"

readonly dir=${1-electron}
echo "${ELECTRON_GN_ROOT}/src/${dir}"
