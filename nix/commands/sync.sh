#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

source $basedir/__load-config.sh

echo Running \"gclient sync\" in \"$ELECTRON_GN_ROOT/src\"
if [ -d "$ELECTRON_GN_ROOT/src" ] 
then
  cd $ELECTRON_GN_ROOT/src
else
  cd $ELECTRON_GN_ROOT
fi

gclient sync --with_branch_heads --with_tags "$@"

echo Updating Git Remotes

cd $ELECTRON_GN_ROOT/src/electron
git remote set-url origin $ELECTRON_GIT_ORIGIN
git remote set-url origin --push $ELECTRON_GIT_ORIGIN

cd $ELECTRON_GN_ROOT/src/third_party/electron_node
git remote set-url origin $NODE_GIT_ORIGIN
git remote set-url origin --push $NODE_GIT_ORIGIN

echo Done Syncing
