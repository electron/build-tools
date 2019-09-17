#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__constants.sh"
source "$basedir/__load-config.sh"

readonly src_path="$ELECTRON_GN_ROOT/src"
echo -e "Running '${COLOR_CMD}gclient sync${COLOR_OFF}' in '${COLOR_DIR}$src_path${COLOR_OFF}'"
mkdir -p "$src_path"
cd "$src_path"
gclient sync --with_branch_heads --with_tags "$@"

echo -e "${COLOR_OK}Updating Git Remotes${COLOR_OFF}"

cd "$src_path/electron"
git remote set-url origin "$ELECTRON_GIT_ORIGIN"
git remote set-url origin --push "$ELECTRON_GIT_ORIGIN"

cd "$src_path/third_party/electron_node"
git remote set-url origin "$NODE_GIT_ORIGIN"
git remote set-url origin --push "$NODE_GIT_ORIGIN"

echo -e "${COLOR_OK}Done Syncing${COLOR_OFF}"
