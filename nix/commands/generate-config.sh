#!/usr/bin/env bash

set -e

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

node $basedir/../../common/generate-config.js

echo Config parsed and generated successfully
