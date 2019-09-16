#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

target_dir=$(pwd)/electron

if [ -d "electron" ]; then
  echo "'$target_dir' already exists. Please remove it or cd to a different directory."
  exit 1
fi

echo "Creating $target_dir for Electron checkout"
mkdir -p "$target_dir"
cd "$target_dir"

echo
echo
echo "Running 'gclient config'"
gclient config --name 'src/electron' --unmanaged 'https://github.com/electron/electron'

new_config=$(node "$basedir/../../common/new-config-for-fetch.js" "$target_dir")

echo
echo
echo "Running 'evm $new_config'"
evm "$new_config"

source "$basedir/__load-config.sh"

echo
echo
echo "Running 'e sync -vv'"
e sync -vv

echo
echo
echo "Running 'e bootstrap'"
e bootstrap

echo
echo
echo "You should be all set! Try running 'e build' to build a local version of Electron now."
