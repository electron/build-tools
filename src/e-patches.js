#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const program = require('commander');
const childProcess = require('child_process');

const evmConfig = require('./evm-config.js');
const { color, fatal } = require('./util');

function exportPatches(target) {
  try {
    const { root } = evmConfig.current();
    const srcdir = path.resolve(root, 'src');

    // build the list of targets
    const targets = {};
    const patchesConfig = path.resolve(root, 'src', 'electron', 'patches', 'config.json');
    for (const [key, val] of Object.entries(JSON.parse(fs.readFileSync(patchesConfig)))) {
      targets[path.basename(key)] = val;
    }

    if (!targets[target]) {
      console.log(`${color.err} Unrecognized target ${color.cmd(target)}.`);
      console.log(
        `${color.err} Supported targets: ${Object.keys(targets)
          .sort()
          .map(a => color.cmd(a))
          .join(', ')}`,
      );
      console.log(`${color.err} See ${color.path(patchesConfig)}`);
      process.exit(1);
    }
    childProcess.execFileSync(
      path.resolve(srcdir, 'electron', 'script', 'git-export-patches'),
      ['-o', path.resolve(srcdir, 'electron', 'patches', target)],
      { cwd: path.resolve(root, targets[target]), stdio: 'inherit', encoding: 'utf8' },
    );
  } catch (e) {
    fatal(e);
  }
}

program
  .arguments('<basename>')
  .description('Refresh the patches in $root/src/electron/patches/$basename')
  .action(exportPatches)
  .parse(process.argv);
