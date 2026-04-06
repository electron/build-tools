#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { program } from 'commander';

import * as evmConfig from './evm-config';
import { execFileSync, spawnSync, type DepotOpts } from './utils/depot-tools';
import { color, fatal } from './utils/logging';

interface PatchTarget {
  patch_dir: string;
  repo: string;
  grep?: string;
}

interface PatchesOptions {
  config: string;
  listTargets: boolean;
  commitUpdates: boolean;
}

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
  .action((target: string | undefined, options: PatchesOptions) => {
    try {
      const config = evmConfig.current();
      const srcdir = path.resolve(config.root, 'src');

      // build the list of targets
      const targets: Record<string, PatchTarget> = {};
      const patchesConfig = options.config;
      if (!fs.existsSync(patchesConfig)) throw `Config file '${patchesConfig}' not found`;
      const configData: unknown = JSON.parse(fs.readFileSync(patchesConfig, 'utf8'));
      if (Array.isArray(configData)) {
        for (const t of configData as PatchTarget[]) targets[path.basename(t.patch_dir)] = t;
      } else if (typeof configData === 'object' && configData) {
        for (const [patch_dir, repo] of Object.entries(configData as Record<string, string>))
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
      } else if (target && targets[target]) {
        const targetConfig = targets[target];
        const script = path.resolve(srcdir, 'electron', 'script', 'git-export-patches');
        const opts: Partial<DepotOpts> = {
          cwd: path.resolve(config.root, targetConfig.repo),
          stdio: 'inherit',
          encoding: 'utf8',
        };
        const args = [script, '--output', path.resolve(config.root, targetConfig.patch_dir)];
        if (targetConfig.grep) args.push('--grep', targetConfig.grep);
        execFileSync(config, 'python3', args, opts);
      } else {
        console.log(`${color.err} Unrecognized target ${color.cmd(String(target))}.`);
        console.log(
          `${color.err} Supported targets: ${[...Object.keys(targets), 'all']
            .sort()
            .map((a) => color.cmd(a))
            .join(', ')}`,
        );
        fatal(`See ${color.path(patchesConfig)}`);
      }

      if (options.commitUpdates) {
        const spawnOpts: Partial<DepotOpts> = {
          cwd: path.resolve(config.root, 'src', 'electron'),
          stdio: 'pipe',
          encoding: 'utf8',
        };

        const changedFilesOutput = spawnSync(
          config,
          'git',
          ['diff', '--name-only', '--diff-filter=d'],
          spawnOpts,
          'Failed to get list of changed files',
        ).stdout.trim();

        if (changedFilesOutput.length === 0) {
          return;
        }

        for (const filename of changedFilesOutput.split('\n')) {
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
