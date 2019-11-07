#!/usr/bin/env node

const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config.js');
const { color, fatal } = require('./util');

function exportPatches(target) {
  try {
    const { root } = evmConfig.current();
    const srcdir = path.resolve(root, 'src');

    const targets = {
      boringssl: path.resolve(srcdir, 'third_party', 'boringssl'),
      chromium: srcdir,
      node: path.resolve(srcdir, 'third_party', 'electron_node'),
      v8: path.resolve(srcdir, 'v8'),
    };
    if (!targets[target]) {
      console.log(`${color.err} Unrecognized dir ${color.path(target)}.`);
      console.log(`${color.err} Supported dirs: ${Object.keys(targets).join(', ')}`);
      process.exit(1);
    }
    childProcess.execFileSync(
      path.resolve(srcdir, 'electron', 'script', 'git-export-patches'),
      ['-o', path.resolve(srcdir, 'electron', 'patches', target)],
      { cwd: targets[target], stdio: 'inherit', encoding: 'utf8' },
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
