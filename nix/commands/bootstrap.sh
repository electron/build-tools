#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-env.sh"
source "$basedir/__tools.sh"
ensure_depot_tools

usage() {
  echo -e "Usage:
  e bootstrap [--type={debug | release | testing}]
              [--asan] [--lsan] [--msan] [--tsan]
              [--out=NAME] [--help | -h]

Options:
  --type=NAME  Generate makefiles that follow the build type
  --out=NAME   Place generated files in \`src/out/\$NAME\`

  --asan       Enable clang's address sanitizer
  --lsan       Enable clang's leak sanitizer
  --msan       Enable clang's memory sanitizer
  --tsan       Enable clang's thread sanitizer

  --h|--help   Print this help page"
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
      echo -e "$(log_error) Unrecognized command $(log_cmd "$arg"). See $(log_cmd 'e bootstrap --help') for usage information."
      exit 1
      ;;
  esac
done

# if user is changing the outDir or buildType,
# update our config files and restart
if [[ "$outDir" != "$ELECTRON_OUT_DIR" || "$buildType" != "$GN_IMPORT_NAME" ]]; then
  echo -e "Updating $(log_dir "$CONFIG_NAME")"
  ensure_node_modules
  node "$basedir/../../common/edit-evm-config" "$CONFIG_NAME" "--electronOutDir=$outDir" "--buildType=$buildType"
  evm "$CONFIG_NAME" 
  e bootstrap "$@" # re-run to pick up the new config
  exit $?
fi

readonly src_path="$ELECTRON_GN_ROOT/src"
echo -e "Running $(log_cmd 'gn gen') in $(log_dir "$src_path")"
cd "$src_path"
PATH="$DEPOT_TOOLS_PATH:$PATH" gn gen "out/$outDir" --args="import(\"//electron/build/args/$buildType.gn\") cc_wrapper=\"$ELECTRON_GN_ROOT/src/electron/external_binaries/sccache\" $EXTRA_GN_ARGS"
