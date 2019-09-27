#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"
source "$basedir/__tools.sh"

cd "$ELECTRON_GN_ROOT/src"

ensure_sccache () {
  SCCACHE_PATH=$ELECTRON_GN_ROOT/src/electron/external_binaries/sccache
  $SCCACHE_PATH --stop-server &> /dev/null || true
  until $SCCACHE_PATH --start-server
  do
    echo -e "$(log_warn) Failed to start sccache. Trying again..."
  done
}

build_target() {
  ensure_sccache
  ensure_depot_tools
  local -r build_dir="${ELECTRON_GN_ROOT}/src/out/${ELECTRON_OUT_DIR}"
  echo -e "Running $(log_cmd 'ninja') in $(log_dir "$build_dir") with target '$1'"
  PATH="$DEPOT_TOOLS_PATH:$PATH" ninja -C "$build_dir" "$1"
}

bad_build_target() {
  echo -e "$(log_err) Unknown build target '$1'. Please check the README for possible targets."
  exit 1
}

pretty_target=$1
target='__bad__'
case "$pretty_target" in
'')
  target=electron
  ;;
'electron')
  target=electron
  ;;
'electron:dist')
  target=electron:electron_dist_zip
  ;;
'mksnapshot')
  target=electron:electron_mksnapshot_zip
  ;;
'chromedriver')
  target=electron:electron_chromedriver_zip
  ;;
'node:headers')
  target=third_party/electron_node:headers
  ;;
'breakpad')
  target=third_party/breakpad:dump_syms
  ;;
esac

if [ "$target" == '__bad__' ]; then
  bad_build_target "$pretty_target"
fi

build_target $target
