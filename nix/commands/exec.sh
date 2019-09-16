#!/usr/bin/env bash

set -e

basedir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

source $basedir/__load-config.sh

echo "$ELECTRON_EXEC"
