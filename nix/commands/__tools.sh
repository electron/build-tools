#!/usr/bin/env bash

# colors

declare -r COLOR_CMD='\033[0;33m' # yellow
declare -r COLOR_DIR='\033[0;36m' # cyan -- same as chalk use in common/
declare -r COLOR_ERR='\033[0;31m' # red
declare -r COLOR_OFF='\033[0m' # no-color
declare -r COLOR_OK='\033[0;32m' # green
declare -r COLOR_WARN='\033[1;31m' # light red

# functions

declare -r DEPOT_TOOLS_PATH="$(git -C "$(dirname "$(readlink -f "$0")")" rev-parse --show-toplevel)/third_party/depot_tools"

ensure_depot_tools() {
  # if it's missing, install it
  if [[ ! -d "$DEPOT_TOOLS_PATH" ]]; then
    echo -e "\n\nCloning ${COLOR_CMD}depot_tools${COLOR_OFF} into '${COLOR_DIR}$DEPOT_TOOLS_PATH${COLOR_OFF}'"
    git clone -q 'https://chromium.googlesource.com/chromium/tools/depot_tools.git' "$DEPOT_TOOLS_PATH"
    if [[ $? -ne 0 ]]; then
      exit $?
    fi
  fi

  # if it's been awhile, update it
  local -r mtime_age_days="$(perl -e 'print int -M $ARGV[0]' "$DEPOT_TOOLS_PATH")"
  local -r update_interval_days=14
  if (( $mtime_age_days > $update_interval_days )); then
    echo -e "\n\nUpdating ${COLOR_CMD}depot_tools${COLOR_OFF} into '${COLOR_DIR}$DEPOT_TOOLS_PATH${COLOR_OFF}'"
    git -C "${DEPOT_TOOLS_PATH}" pull origin master
    touch "${DEPOT_TOOLS_PATH}"
  fi
}

ensure_node_modules() {
  # if it's missing, install it
  local -r top="$(git -C "$(dirname "$(readlink -f "$0")")" rev-parse --show-toplevel)"
  if [[ ! -d "$top/node_modules" ]]; then
    echo -e "\n\nRunning '${COLOR_CMD}yarn install${COLOR_OFF}' in '${COLOR_DIR}$top${COLOR_OFF}'"
    yarn --cwd "$top" install
    if [[ $? -ne 0 ]]; then
      exit $?
    fi
  fi
}
