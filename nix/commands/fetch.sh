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

# create $gn_root
echo -e "\\n\\nCreating '${COLOR_DIR}${gn_root}${COLOR_OFF}' for Electron checkout"
if [[ -d "$gn_root" ]]; then
  echo -e "${COLOR_ERR}'${COLOR_DIR}${gn_root}${COLOR_ERR}' already exists. Please select a new directory.${COLOR_OFF}"
  exit 1
fi
mkdir -p "$gn_root"
cd "$gn_root"

# run gclient config
echo -e "\\n\\nRunning '${COLOR_CMD}gclient config${COLOR_OFF}' in '${COLOR_DIR}$gn_root${COLOR_OFF}'"
PATH="$DEPOT_TOOLS_PATH:$PATH" gclient config --name 'src/electron' --unmanaged 'https://github.com/electron/electron'
args=( "--root=$gn_root" )
if [[ "$evm_name" != "" ]]; then
  args+=( "--name=$evm_name" )
fi
new_config=$(node "$basedir/../../common/create-evm-config" "${args[@]}")

# run evm
echo -e "\\n\\nRunning '${COLOR_CMD}evm $new_config${COLOR_OFF}'"
evm "$new_config"

# run e sync
source "$basedir/__load-env.sh" 
if [[ "$verbose" != '' ]]; then
  echo -e "\\n\\nRunning '${COLOR_CMD}e sync ${verbose}${COLOR_OFF}'"
  e sync "$verbose"
else
  echo -e "\\n\\nRunning '${COLOR_CMD}e sync${COLOR_OFF}'"
  e sync
fi

# run e bootstrap
echo -e "\\n\\nRunning '${COLOR_CMD}e bootstrap ${bootstrap_args[*]}${COLOR_OFF}'"
e bootstrap "${bootstrap_args[@]}"

echo -e "\\n\\nYou should be all set! Try running '${COLOR_CMD}e build${COLOR_OFF}' to build Electron now."
