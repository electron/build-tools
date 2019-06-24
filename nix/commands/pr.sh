#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

cd $ELECTRON_GN_ROOT/src/electron

base=$(node $basedir/../../common/guess-pr-target)
head=$(git rev-parse --abbrev-ref HEAD)

open "https://github.com/electron/electron/compare/$base...$head?expand=1"