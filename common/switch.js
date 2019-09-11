const chalk = require('chalk').default;
const fs = require('fs');
const path = require('path');

const switchTarget = process.argv[2];

if (switchTarget === 'example') {
  console.error('Tried to switch to config.example.yml, you probably should not be switching to an example config');
  process.exit(1);
}

const configPath = path.resolve(__dirname, '..', `config.${switchTarget}.yml`);

if (!fs.existsSync(configPath)) {
  console.error(chalk.red(`Config file: ${configPath} not found`));
  process.exit(1);
}

global.CONFIG_PATH_OVERRIDE = configPath;

require('./generate-config');

console.log('Switched to:', chalk.cyan(path.basename(configPath)));
