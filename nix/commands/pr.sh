#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-config.sh"

cd "$ELECTRON_GN_ROOT/src/electron"

base=$(node "$basedir/../../common/guess-pr-target")
head=$(git rev-parse --abbrev-ref HEAD)
url="https://github.com/electron/electron/compare/$base...$head?expand=1"

if [[ "$OSTYPE" = "linux-gnu" ]]; then
  xdg-open "$url"
else
  open "$url"
fi
