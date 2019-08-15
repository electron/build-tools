const chalk = require('chalk').default;
const fs = require('fs');
const yaml = require('yaml-js');

const fail = (message) => {
  console.error(chalk.red(message));
  process.exit(1);
};

const { configPath, resolveConfiguredPath } = require('./util');

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
  },
];

if (!fs.existsSync(configPath)) {
  fail('You must create a config.yml file in the root of this repository, copy config.example.yml to get started');
}

const config = yaml.load(fs.readFileSync(configPath))

for (const prop of REQUIRED_CONFIG_PROPERTIES) {
  const value = config[prop.name];

  if (!value) {
    fail(`The config property "${prop.name}" must be set to a ${prop.type} before using these scripts.`);
  }

  switch (prop.type) {
    case 'path': {
      if (!fs.existsSync(resolveConfiguredPath(value))) {
        fail(`The config property "${prop.name}" must be a path that exists, but "${resolveConfiguredPath(value)}" does not exist :(`);
      }
      break;
    }
    default:
      fail(`The config property "${prop.name}" was configured incorrectly in these helpers scripts, please raise an issue if you see this`);
  }
}

module.exports = {
  config,
};
