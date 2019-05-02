#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

echo Running \"gclient sync\" in \"$ELECTRON_GN_ROOT/src\"
cd $ELECTRON_GN_ROOT/src

gclient sync --with_branch_heads --with_tags -D "$@"

echo Updating Git Remotes

cd $ELECTRON_GN_ROOT/src/electron
git remote set-url origin git@github.com:electron/electron.git
git remote set-url origin --push git@github.com:electron/electron.git

cd $ELECTRON_GN_ROOT/src/third_party/electron_node
git remote set-url origin git@github.com:electron/node.git
git remote set-url origin --push git@github.com:electron/node.git

echo Done Syncing
