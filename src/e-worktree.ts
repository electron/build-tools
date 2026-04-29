#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import { resolvePath, deleteDir, ensureBuildtoolsSymlink } from './utils/paths.js';
import * as depot from './utils/depot-tools.js';
import type { SanitizedConfig } from './types.js';

interface AddOptions {
  source?: string;
  out?: string;
  sync: boolean;
  force: boolean;
}

interface CleanOptions {
  yes: boolean;
}

function isDerivedWorktree(root: string): boolean {
  // gclient-new-workdir.py symlinks .gclient to the source checkout; a primary
  // checkout always has a regular file here, so this alone distinguishes them.
  const gclient = path.join(root, '.gclient');
  try {
    return fs.lstatSync(gclient).isSymbolicLink();
  } catch {
    return false;
  }
}

program
  .name('e worktree')
  .description(
    'Manage additional gclient working directories that share git objects with an existing checkout',
  );

program
  .command('add')
  .argument('<name>', 'Name for the new build configuration')
  .argument('<new_workdir>', 'Directory for the new working tree (must not exist)')
  .description('Create a new worktree and matching build config cloned from an existing one')
  .option('--source <config>', 'Existing build config to clone from (default: current)')
  .option(
    '-o, --out <name>',
    'Built files will be placed in $root/src/out/$out (default: same as source)',
  )
  .option('--no-sync', 'Skip running `e sync` after creating the worktree')
  .option('-f, --force', 'Overwrite an existing build config of the same name', false)
  .action((name: string, newWorkdir: string, options: AddOptions) => {
    try {
      if (os.platform() === 'win32') {
        fatal(
          '`e worktree` is not supported on Windows (gclient-new-workdir.py requires symlinks)',
        );
      }

      const sourceName = options.source ?? evmConfig.currentName();
      const sourceConfig = evmConfig.fetchByName(sourceName);
      const sourceRoot = sourceConfig.root;

      if (!fs.existsSync(path.join(sourceRoot, '.gclient'))) {
        fatal(
          `Source root ${color.path(sourceRoot)} has no .gclient file. ` +
            `Run ${color.cmd('e sync')} in config ${color.config(sourceName)} first.`,
        );
      }

      const targetRoot = resolvePath(newWorkdir);
      if (fs.existsSync(targetRoot)) {
        fatal(`Target directory ${color.path(targetRoot)} already exists.`);
      }

      const filename = evmConfig.pathOf(name);
      if (!options.force && fs.existsSync(filename)) {
        fatal(
          `Build config ${color.config(name)} already exists (${color.path(filename)}). ` +
            `Use --force to overwrite.`,
        );
      }

      depot.ensure();

      console.log(
        `Creating worktree from ${color.config(sourceName)} (${color.path(sourceRoot)}) ` +
          `→ ${color.path(targetRoot)}`,
      );
      const script = path.join(depot.path, 'gclient-new-workdir.py');
      depot.spawnSync(
        sourceConfig,
        'python3',
        [script, sourceRoot, targetRoot],
        { stdio: 'inherit' },
        'gclient-new-workdir.py failed',
      );

      const newConfig: SanitizedConfig = structuredClone(sourceConfig);
      newConfig.root = targetRoot;
      newConfig.gen.out = options.out ?? sourceConfig.gen.out;
      delete newConfig.env.CHROMIUM_BUILDTOOLS_PATH;
      ensureBuildtoolsSymlink(targetRoot);

      evmConfig.save(name, newConfig);
      console.log(`New build config ${color.config(name)} created in ${color.path(filename)}`);

      evmConfig.setCurrent(name);
      console.log(`Now using config ${color.config(name)}`);

      if (options.sync) {
        console.log(
          `Running ${color.cmd('e sync')} to fetch toolchains and apply patches in the new worktree...`,
        );
        const e = path.resolve(import.meta.dirname, 'e');
        const opts: childProcess.ExecFileSyncOptions = { stdio: 'inherit' };
        childProcess.execFileSync(process.execPath, [e, 'sync'], opts);
      } else {
        console.log(
          `${color.info} Skipped sync. Run ${color.cmd('e sync')} in this config before building.`,
        );
      }

      console.log(`${color.success} Worktree ready at ${color.path(targetRoot)}`);
      console.log(
        `${color.info} When finished, remove with ${color.cmd(`e worktree clean ${name} --yes`)}`,
      );
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('clean')
  .argument('<name>', 'Build config whose worktree should be deleted')
  .description('Delete a worktree directory and its build config')
  .option('--yes', 'Confirm deletion (required; this removes the entire worktree directory)', false)
  .action((name: string, options: CleanOptions) => {
    try {
      const config = evmConfig.fetchByName(name);
      const root = config.root;

      if (!isDerivedWorktree(root)) {
        fatal(
          `${color.path(root)} does not look like a worktree created by ${color.cmd('e worktree add')} ` +
            `(.gclient must be a symlink). Refusing to delete.`,
        );
      }

      let active: string | null;
      try {
        active = evmConfig.currentName();
      } catch {
        active = null;
      }
      if (active === name) {
        fatal(
          `Config ${color.config(name)} is currently in use. ` +
            `Switch to another config with ${color.cmd('e use <other>')} first.`,
        );
      }

      if (!options.yes) {
        fatal(
          `This will delete ${color.path(root)} and the ${color.config(name)} config. ` +
            `Re-run with ${color.cmd('--yes')} to confirm.`,
        );
      }

      console.log(`Deleting ${color.path(root)}...`);
      deleteDir(root);

      evmConfig.remove(name);
      console.log(`Removed config ${color.config(name)}`);

      console.log(`${color.success} Worktree ${color.path(root)} removed`);
    } catch (e) {
      fatal(e);
    }
  });

program.addHelpText(
  'after',
  `
Examples:
  $ e worktree add testing2 ~/src/electron2
  $ e worktree add asan ~/src/electron-asan --source testing -o Asan --no-sync
  $ e worktree clean testing2 --yes`,
);

program.parse(process.argv);
