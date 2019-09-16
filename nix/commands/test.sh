#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
source "$basedir/__load-config.sh"

# to run the tests, you'll first need to build the test modules
# against the same version of Node.js that was built as part of
# the build process.
declare -r build_dir="${ELECTRON_GN_ROOT}/src/out/${ELECTRON_OUT_DIR}"
declare -r node_headers_dir="${build_dir}/gen/node_headers"
declare -r electron_spec_dir="${ELECTRON_GN_ROOT}/src/electron/spec"

# does it need to be rebuilt?
if [ ! -d "${node_headers_dir}" ]; then
  declare -r node_headers_need_rebuild='yes'
elif [ "${electron_spec_dir}/package.json" -nt "${node_headers_dir}" ]; then
  declare -r node_headers_need_rebuild='yes'
else
  declare -r node_headers_need_rebuild='no'
fi

if [ "x$node_headers_need_rebuild" != 'xno' ]; then
  ninja -C "${build_dir}" third_party/electron_node:headers
  # install the test modules with the generated headers
  (cd "${electron_spec_dir}" && npm i --nodedir="${node_headers_dir}")
  touch "${node_headers_dir}"
fi

cd "$ELECTRON_GN_ROOT/src/electron"
ELECTRON_OUT_DIR="$ELECTRON_OUT_DIR" node ./script/spec-runner.js $@
