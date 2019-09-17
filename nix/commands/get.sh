#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "${basedir}/__load-config.sh"

readonly command="$1"
case $command in
  --help)
    echo rUse: e get [exe | out | src [name]]'
    echo 'exe: the path to built Electron executable'
    echo 'out: the outdir, e.g. "Testing"'
    echo 'src: the path to the "name" (default:electron) source directory, e.g. "/path/to/electron/src/electron"'
    exit 0
    ;;
  exe)
    echo "$ELECTRON_EXEC"
    exit 0
    ;;
  out)
    echo "$ELECTRON_OUT_DIR"
    exit 0
    ;;
  src)
    readonly dir=${2-electron}
    echo "${ELECTRON_GN_ROOT}/src/${dir}"
    exit 0
    ;;
  *)
    echo "Unrecognized command '$command'. Must be one of 'exe', '--help', 'out', or 'src'."
    exit 1
    ;;
esac
