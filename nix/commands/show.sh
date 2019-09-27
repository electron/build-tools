#!/usr/bin/env bash

set -e

usage() {
  echo -e "Usage:
  e show [-h|--help] {exe | out | src [name]}

Options:
  -h, --help  Shows this usage message

Commands:
  exe  The path to built Electron executable
  out  The outdir, e.g. \"Testing\"
  src  The path to the named source directory (default:electron) e.g. \"/path/to/electron/src/electron\""
}

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "${basedir}/__load-env.sh"
source "${basedir}/__tools.sh"

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
  --help|-h)
    usage
    exit 0
    ;;
  *)
    echo -e "$(log_error) Unrecognized subcommand $(log_cmd "$1"). See $(log_cmd 'e show --help') for usage details."
    exit 1
    ;;
esac
