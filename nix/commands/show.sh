#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "${basedir}/__load-config.sh"

readonly command="$1"
case $command in
  exe|exec)
    echo "$ELECTRON_EXEC"
    ;;
  out)
    echo "$ELECTRON_OUT_DIR"
    ;;
  src)
    readonly dir=${2-electron}
    echo "${ELECTRON_GN_ROOT}/src/${dir}"
    ;;
  *)
    echo "Usage: e show {exe | out | src [name]}"
    echo "exe: the path to built Electron executable"
    echo "out: the outdir, e.g. \"Testing\""
    echo "src: the path to the named source directory (default:electron) e.g. \"/path/to/electron/src/electron\""
    ;;
esac
