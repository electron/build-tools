#!/usr/bin/env bash

# constants

declare __current_color='\e[39m\e[49m' # initial: fg:default bg:default

log_cmd() {
  local -r text="$1"
  local -r color='\e[33m\e[49m' # fg:yellow bg:default
  echo -n "${__current_color}'${color}${text}${__current_color}'"
}

log_dir() {
  local -r text="$1"
  local -r color='\e[36m\e[49m' # fg:cyan bg:default
  echo -n "${__current_color}\"${color}${text}${__current_color}\""
}

log_warn() {
  local -r color='\e[30m\e[103m' # fg:black bg:light-yellow
  echo -n "${color}WARN${__current_color}"
}

log_error() {
  local -r color='\e[97m\e[101m' # fg:white bg:light-red
  echo -n "${color}ERROR${__current_color}"
}

log_ok() {
  local -r text="$1"
  local -r color='\e[32m\e[49m' # fg:green bg:default
  echo -n "${color}${text}${__current_color}"
}

declare __basedir
__basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

ELECTRON_GN_SCRIPTS_ROOT="$(git -C "${__basedir}" rev-parse --show-toplevel)"
declare -r ELECTRON_GN_SCRIPTS_ROOT

declare -r DEPOT_TOOLS_PATH="${ELECTRON_GN_SCRIPTS_ROOT}/third_party/depot_tools"
unset __basedir

# functions

ensure_depot_tools() {
  # if it's missing, install it
  if [[ ! -d "$DEPOT_TOOLS_PATH" ]]; then
    echo -e "\\n\\nCloning $(log_cmd 'depot_tools') into $(log_dir "$DEPOT_TOOLS_PATH")"
    if ! git clone -q 'https://chromium.googlesource.com/chromium/tools/depot_tools.git' "$DEPOT_TOOLS_PATH"; then
      echo -e "$(log_error) Failed to clone depot_tools!"
      exit 1
    fi
  fi

  # if it's been awhile, update it
  local -r mtime_age_days="$(perl -e 'print int -M $ARGV[0]' "$DEPOT_TOOLS_PATH")"
  local -r update_interval_days=14
  if (( mtime_age_days > update_interval_days )); then
    echo -e "\\n\\nUpdating $(log_dir "$DEPOT_TOOLS_PATH")"
    git -C "${DEPOT_TOOLS_PATH}" pull origin master
    touch "${DEPOT_TOOLS_PATH}"
  fi
}

ensure_node_modules() {
  # if it's missing, install it
  if [[ ! -d "${ELECTRON_GN_SCRIPTS_ROOT}/node_modules" ]]; then
    echo -e "\\n\\nRunning $(log_cmd 'yarn install') in $(log_dir "$ELECTRON_GN_SCRIPTS_ROOT")"
    if ! npx yarn --cwd "${ELECTRON_GN_SCRIPTS_ROOT}" install --frozen-lockfile; then
      echo -e "$(log_err) Failed to install node modules!"
      exit 1
    fi
  fi
}
