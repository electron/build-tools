#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const program = require('commander');

const evmConfig = require('./evm-config.js');
const { execFileSync, spawnSync } = require('./utils/depot-tools');
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
  .option('--commit-updates', 'Automatically commit any non-content changes to patches', false)
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

      // Automatically committing requires a clean working directory to avoid conflicts
      if (options.commitUpdates) {
        const gitStatusResult = spawnSync(config, 'git', ['status', '--porcelain'], {
          cwd: path.resolve(config.root, 'src', 'electron'),
          stdio: 'pipe',
          encoding: 'utf8',
        });
        if (gitStatusResult.status !== 0 || gitStatusResult.stdout.trim().length !== 0) {
          console.error(
            `${color.err} Your current git working directory is not clean, we can't commit patch updates.`,
          );
          options.commitUpdates = false;
        }
      }

      if (target === 'all') {
        const script = path.resolve(srcdir, 'electron', 'script', 'export_all_patches.py');
        execFileSync(config, 'python3', [script, patchesConfig], {
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
        execFileSync(config, 'python3', args, opts);
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

      if (options.commitUpdates) {
        const spawnOpts = {
          cwd: path.resolve(config.root, 'src', 'electron'),
          stdio: 'pipe',
          encoding: 'utf8',
        };

        const changedFiles = spawnSync(
          config,
          'git',
          ['diff', '--name-only', '--diff-filter=d'],
          spawnOpts,
          'Failed to get list of changed files',
        );

        for (const filename of changedFiles.stdout.trim().split('\n')) {
          if (!filename.startsWith('patches/')) {
            console.error(`${color.err} Unexpectedly found non-patch file change: ${filename}`);
            return;
          }

          const gitDiff = spawnSync(
            config,
            'git',
            ['diff', filename],
            spawnOpts,
            `Failed to get git diff for ${filename}`,
          );
          const changedLines = gitDiff.stdout.matchAll(/^[-+].*$/gm);

          let stageFile = true;

          for (const line of changedLines) {
            // If we find a content-related change, skip this file
            if (!line[0].match(/^[-+](--|\+\+|index|@@) /)) {
              console.info(`${color.info} Skipping commit of ${filename} due to content changes.`);
              stageFile = false;
              break;
            }
          }

          if (stageFile) {
            spawnSync(
              config,
              'git',
              ['add', filename],
              spawnOpts,
              `Failed to stage file ${filename}`,
            );
          }
        }

        const commitMessage = 'chore: update patches';

        spawnSync(
          config,
          'git',
          ['commit', '-n', '-m', os.platform() === 'win32' ? `"${commitMessage}"` : commitMessage],
          spawnOpts,
          'Failed to commit patch changes',
        );
      }
    } catch (e) {
      fatal(e);
    }
  });

program.parse(process.argv);
