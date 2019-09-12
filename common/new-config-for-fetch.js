const fs = require('fs');
const path = require('path');

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
while (fs.existsSync(path.resolve(__dirname, '..', `config.${configName}.yml`))) {
  n++;
  configName = `master${n}`;
}

fs.writeFileSync(path.resolve(__dirname, '..', `config.${configName}.yml`), content);

process.stdout.write(configName);
