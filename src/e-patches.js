#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config.js');
const depot = require('./utils/depot-tools');
const { color, fatal } = require('./utils/logging');

program
  .arguments('[target]')
  .description(
    "Refresh all patches if 'all' is specified; otherwise, refresh patches in $root/src/electron/patches/$target",
  )
  .option(
    '-c, --config <filename>',
    'Specify a config file',
    path.resolve(evmConfig.current().root, 'src', 'electron', 'patches', 'config.json'),
  )
  .option('--list-targets', 'Show all supported patch targets', false)
  .action((target, options) => {
    try {
      const config = evmConfig.current();
      const srcdir = path.resolve(config.root, 'src');

      // build the list of targets
      const targets = {};
      const patchesConfig = options.config;
      if (!fs.existsSync(patchesConfig)) throw `Config file '${patchesConfig}' not found`;
      const configData = JSON.parse(fs.readFileSync(patchesConfig));
      if (Array.isArray(configData)) {
        for (const target of configData) targets[path.basename(target.patch_dir)] = target;
      } else if (typeof configData == 'object') {
        for (const [patch_dir, repo] of Object.entries(configData))
          targets[path.basename(patch_dir)] = { patch_dir, repo };
      }

      if (options.listTargets) {
        console.log(
          `Supported targets: ${[...Object.keys(targets), 'all']
            .sort()
            .map((a) => color.cmd(a))
            .join(', ')}`,
        );
        console.log(`See ${color.path(patchesConfig)}`);
        return;
      }

      if (target === 'all') {
        const script = path.resolve(srcdir, 'electron', 'script', 'export_all_patches.py');
        depot.execFileSync(config, 'python3', [script, patchesConfig], {
          cwd: config.root,
          stdio: 'inherit',
          encoding: 'utf8',
        });
      } else if (targets[target]) {
        const targetConfig = targets[target];
        const script = path.resolve(srcdir, 'electron', 'script', 'git-export-patches');
        const opts = {
          cwd: path.resolve(config.root, targetConfig.repo),
          stdio: 'inherit',
          encoding: 'utf8',
        };
        const args = [script, '--output', path.resolve(config.root, targetConfig.patch_dir)];
        if (targetConfig.grep) args.push('--grep', targetConfig.grep);
        depot.execFileSync(config, 'python3', args, opts);
      } else {
        console.log(`${color.err} Unrecognized target ${color.cmd(target)}.`);
        console.log(
          `${color.err} Supported targets: ${[...Object.keys(targets), 'all']
            .sort()
            .map((a) => color.cmd(a))
            .join(', ')}`,
        );
        fatal(`See ${color.path(patchesConfig)}`);
      }
    } catch (e) {
      fatal(e);
    }
  });

program.parse(process.argv);
