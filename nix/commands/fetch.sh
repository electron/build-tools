#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__tools.sh"
ensure_depot_tools
ensure_node_modules

# Get the target directory (default: $PWD/electron)
target_dir="${1-"$PWD/electron"}"
if [[ "$target_dir" != /* ]]; then
  target_dir="$PWD/$target_dir"
fi

if [[ -d "$target_dir" ]]; then
  echo -e "$(log_error)$(log_dir "$target_dir") already exists. Please select a new directory."
  exit 1
fi

echo
echo
echo -e "Creating $(log_dir "$target_dir") for Electron checkout"
mkdir -p "$target_dir"
cd "$target_dir"

echo
echo
echo -e "Running $(log_cmd 'gclient config') in $(log_dir "$target_dir")"
PATH="$DEPOT_TOOLS_PATH:$PATH" gclient config --name 'src/electron' --unmanaged 'https://github.com/electron/electron'

new_config=$(node "$basedir/../../common/new-config-for-fetch.js" "$target_dir")

echo
echo
echo -e "Running $(log_cmd "evm ${new_config}")"
evm "$new_config"

source "$basedir/__load-env.sh"

echo
echo
echo -e "Running $(log_cmd 'e sync -vv')"
e sync -vv

echo
echo
echo -e "Running $(log_cmd 'e bootstrap')"
e bootstrap

echo
echo
echo -e "You should be all set! Try running $(log_cmd 'e build') to build Electron now."
