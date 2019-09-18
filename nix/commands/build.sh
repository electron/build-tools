#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__constants.sh"
source "$basedir/__load-config.sh"

cd "$ELECTRON_GN_ROOT/src"

ensure_sccache () {
  SCCACHE_PATH=$ELECTRON_GN_ROOT/src/electron/external_binaries/sccache
  $SCCACHE_PATH --stop-server &> /dev/null || true
  until $SCCACHE_PATH --start-server
  do
    echo -e "${COLOR_WARN}Failed to start sccache, trying again...${COLOR_OFF}"
  done
}

build_target() {
  ensure_sccache
  echo -e "Running '${COLOR_CMD}ninja${COLOR_OFF}' in '${COLOR_DIR}$ELECTRON_GN_ROOT/src${COLOR_OFF}' with target '$1'"
  ninja -C "out/$ELECTRON_OUT_DIR" "$1"
}

bad_build_target() {
  echo -e "${COLOR_ERR}Unknown build target \"$1\", please check the README for possible targets${COLOR_OFF}"
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
