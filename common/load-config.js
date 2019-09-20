const chalk = require('chalk').default;
const fs = require('fs-extra');
const yaml = require('yaml-js');

const fail = (message) => {
  console.error(chalk.red(message));
  process.exit(1);
};

const { resolveConfiguredPath } = require('./util');

const REQUIRED_CONFIG_PROPERTIES = [
  {
    name: 'electronRoot',
    info: 'This property must be an absolute path to the root of your `gclient` initialized directory.  (The directory containing the "src" folder',
    type: 'path',
  },
  {
    name: 'gitCachePath',
    info: 'This property must be an absolute path to the directory you want to use as your chromium git cache.  This directory must exist.',
    type: 'path',
    autoCreate: true,
  },
];

function validateProperty(config, prop) {
  const value = config[prop.name];
  if (!value) {
    fail(`The config property "${prop.name}" must be set to a ${prop.type} before using these scripts.`);
  }

  switch (prop.type) {
    case 'path': {
      if (!fs.existsSync(resolveConfiguredPath(value))) {
        if (prop.autoCreate) {
          fs.mkdirpSync(resolveConfiguredPath(value));
        } else {
          fail(`The config property "${prop.name}" must be a path that exists, but "${resolveConfiguredPath(value)}" does not exist. :(`);
        }
      }
      break;
    }
    default:
      fail(`The config property "${prop.name}" was configured incorrectly in the helpers scripts.  Please raise an issue if you see this.`);
  }
}

function main(configFile) {
  if (!fs.existsSync(configFile)) {
    fail('You must create a config.yml file in the root of this repository, copy config.example.yml to get started');
    return {};
  }

  const config = yaml.load(fs.readFileSync(configFile));
  if (!config) {
    fail(`Unable to parse '${configFile}'`);
  } else for (const prop of REQUIRED_CONFIG_PROPERTIES) {
    validateProperty(config, prop);
  }

  return config
}

module.exports = main
