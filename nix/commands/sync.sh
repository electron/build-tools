#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"
source "$basedir/__tools.sh"
ensure_depot_tools

readonly src_path="$ELECTRON_GN_ROOT/src"
echo -e "Running $(log_cmd "gclient sync $*") in $(log_dir "$src_path")"
mkdir -p "$src_path"
cd "$src_path"
PATH="$DEPOT_TOOLS_PATH:$PATH" gclient sync --with_branch_heads --with_tags "$@"

echo -e "$(log_ok 'Updating Git Remotes')"

cd "$src_path/electron"
git remote set-url origin "$ELECTRON_GIT_ORIGIN"
git remote set-url origin --push "$ELECTRON_GIT_ORIGIN"

cd "$src_path/third_party/electron_node"
git remote set-url origin "$NODE_GIT_ORIGIN"
git remote set-url origin --push "$NODE_GIT_ORIGIN"

echo -e "$(log_ok 'Done Syncing')"
