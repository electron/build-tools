#!/usr/bin/env bash

basedir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

config_path="$basedir/../../generated.env.sh"

if [ ! -f "$config_path" ]; then
    echo You configuration has not been generated, please run \"generate-config\"
    exit 1
  else
    source $config_path
  fi
