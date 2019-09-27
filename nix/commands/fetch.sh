#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__tools.sh"
ensure_depot_tools
ensure_node_modules

usage() {
  echo -e "Usage:
  e fetch [-h|--help] [-v|-vv|-vvv] [--name=STRING] [--root=PATH] [...bootstrap-args]

Options:
  --name=STRING      Arbitrary user-chosen evm config name. Used when invoking \`evm\`.
  --root=PATH        Fetch everything into this new directory. (default=\$PWD/electron)
  -v|-vv|-vvv        Verbosity level when fetching.
  ...bootstrap-args  Remaining args are passed to \`e bootstrap\`. See \`e bootstrap --help\`"
}

# arg defaults
declare bootstrap_args=()
declare gn_root="$PWD/electron"
declare evm_name=''
declare verbose=''

# parse the command line
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    -v|-vv|-vvv)
      verbose="$arg"
      ;;
    --root=*)
      gn_root="${arg:7}"
      ;;
    --name=*)
      evm_name="${arg:7}"
      ;;
    *)
      bootstrap_args+=( "$arg" )
      ;;
  esac
done


# canonize $gn_root
if [[ "$gn_root" = \~/* ]]; then
  gn_root="$HOME/${gn_root:2}"
elif [[ "$gn_root" != /* ]]; then
  gn_root="$PWD/$gn_root"
fi

echo -e "\\n\\nCreating $(log_dir "$gn_root") for Electron checkout"
if [[ -d "$gn_root" ]]; then
  echo -e "$(log_error) $(log_dir "$gn_root") already exists. Please select a new directory."
  exit 1
fi
mkdir -p "$gn_root"
cd "$gn_root"

echo -e "\\n\\nRunning $(log_cmd 'gclient config') in $(log_dir "$gn_root")"
PATH="$DEPOT_TOOLS_PATH:$PATH" gclient config --name 'src/electron' --unmanaged 'https://github.com/electron/electron'
args=( "--root=$gn_root" )
if [[ "$evm_name" != "" ]]; then
  args+=( "--name=$evm_name" )
fi
new_config=$(node "$basedir/../../common/create-evm-config" "${args[@]}")

echo -e "\\n\\nRunning $(log_cmd "evm ${new_config}")"
evm "$new_config"

# run e sync
source "$basedir/__load-env.sh" 
if [[ "$verbose" != '' ]]; then
  echo -e "Running $(log_cmd "e sync $verbose")"
  e sync "$verbose"
else
  echo -e "Running $(log_cmd 'e sync')"
  e sync
fi

# run e bootstrap
echo -e "\\n\\nRunning $(log_cmd 'e bootstrap')"
e bootstrap "${bootstrap_args[@]}"

echo -e "\\n\\nRunning $(log_cmd 'e bootstrap')"
e bootstrap

echo -e "\\n\\nYou should be all set! Try running $(log_cmd 'e build') to build Electron now."

