const fs = require('fs');
const path = require('path');
const { getConfigFile } = require('./util');

if (!process.argv[2]) {
  throw new Error('Missing path for new config file');
}

const content = `
electronRoot: ${process.argv[2]}
gitCachePath: ~/.git_cache
electronOutDir: Testing
buildType: testing
`.trim();

let configName = 'master';
let n = 0;
while (fs.existsSync(getConfigFile(configName))) {
  n++;
  configName = `master${n}`;
}

fs.writeFileSync(getConfigFile(configName), content);

process.stdout.write(configName);
