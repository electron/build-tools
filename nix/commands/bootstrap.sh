#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"
source "$basedir/__tools.sh"
ensure_depot_tools

usage() {
  echo -e "Usage:
  e bootstrap [--help | -h]
              [--type={debug | release | testing}]
              [--asan] [--lsan] [--msan] [--tsan]
              [--out=NAME]

Options:
  --asan       Enable clang's address sanitizer
  --h|--help   Print this help page
  --lsan       Enable clang's leak sanitizer
  --msan       Enable clang's memory sanitizer
  --out=NAME   Place generated files in \`src/out/\$NAME\`
  --tsan       Enable clang's thread sanitizer
  --type=NAME  Generate makefiles that follow the build type"
}

# parse the command line
declare outDir="$ELECTRON_OUT_DIR"
declare buildType="$GN_IMPORT_NAME"
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --out=*)
      outDir="${arg:6}"
      ;;
    --?san) # --asan, --lsan, --msan, --tsan
      EXTRA_GN_ARGS="${EXTRA_GN_ARGS} is_${arg:2}=true"
      ;;
    --type=*)
      buildType="${arg:7}"
      ;;
    --debug|--release|--testing)
      buildType="${arg:2}"
      ;;
    *)
      echo -e "${COLOR_ERR}Unrecognized command '${COLOR_CMD}${arg}${COLOR_ERR}'. See \`${COLOR_CMD}e bootstrap --help${COLOR_ERR}\` for usage information."
      exit 1
      ;;
  esac
done

# if user is changing the outDir or buildType,
# update our config files and restart
if [[ "$outDir" != "$ELECTRON_OUT_DIR" || "$buildType" != "$GN_IMPORT_NAME" ]]; then
  echo -e "Updating '${COLOR_DIR}${CONFIG_NAME}${COLOR_OFF}'"
  ensure_node_modules
  node "$basedir/../../common/edit-evm-config" "$CONFIG_NAME" "--electronOutDir=$outDir" "--buildType=$buildType"
  evm "$CONFIG_NAME" 
  e bootstrap "$@" # re-run to pick up the new config
  exit $?
fi

readonly src_path="$ELECTRON_GN_ROOT/src"
echo -e "Running '${COLOR_CMD}gn gen${COLOR_OFF}' in '${COLOR_DIR}$src_path${COLOR_OFF}'"
cd "$src_path"
PATH="$DEPOT_TOOLS_PATH:$PATH" gn gen "out/$outDir" --args="import(\"//electron/build/args/$buildType.gn\") cc_wrapper=\"$ELECTRON_GN_ROOT/src/electron/external_binaries/sccache\" $EXTRA_GN_ARGS"
