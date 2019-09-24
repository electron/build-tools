const chalk = require('chalk').default;
const fs = require('fs');
const path = require('path');
const { getConfigFile } = require('./util');
const generateEnv = require('./generate-env');

const switchTarget = process.argv[2];

if (switchTarget === 'example') {
  console.error('Tried to switch to config.example.yml, you probably should not be switching to an example config');
  process.exit(1);
}

const configFile = getConfigFile(switchTarget);

if (!fs.existsSync(configFile)) {
  console.error(chalk.red(`Config file: ${configFile} not found`));
  process.exit(1);
}

generateEnv(configFile);

console.log('Switched to:', chalk.cyan(path.basename(configFile)));
