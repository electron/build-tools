#!/usr/bin/env bash
# shellcheck disable=SC2086,SC2124

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"

# wrapper fn to check if a key exists in a hashmap
function array_key_exists() {
  local _array_name="$1"
  local _key="$2"
  local _cmd="echo ${!"$_array_name"[@]}"
  local _array_keys
  mapfile -t _array_keys < <(eval $_cmd)

  local _key_exists
  _key_exists=$(echo "${_array_keys[@]}" | grep " $_key " &>/dev/null; echo $?)

  [[ "$_key_exists" = "0" ]] && return 0 || return 1
}

# init hashmap of valid patch directories
declare -A patch_dirs
patch_dirs["node"]="third_party/electron_node"
patch_dirs["v8"]="v8"
patch_dirs["chromium"]=""
patch_dirs["boringssl"]="third_party/boringssl"

SRC_DIR=$ELECTRON_GN_ROOT/src

if [[ "$(array_key_exists 'patch_dirs' "$1"; echo $?)" = "0" ]]; then
  cd "$SRC_DIR/${patch_dirs[$@]}"
  "$SRC_DIR/electron/script/git-export-patches" -o "$SRC_DIR/electron/patches/$1"
else
  echo "Error: $1 is not a valid patch directory."
fi
