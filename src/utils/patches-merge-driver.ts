import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { color } from './logging.js';

export const PATCHES_MERGE_DRIVER_NAME = 'patches-list';
export const PATCHES_MERGE_ATTRIBUTE = `patches/**/.patches merge=${PATCHES_MERGE_DRIVER_NAME}`;

// Git runs merge drivers through `sh -c`, so quote both paths and use forward
// slashes (fine for node.exe and for Git for Windows' sh; backslashes are not).
function shellQuote(p: string): string {
  return `"${p.replace(/\\/g, '/')}"`;
}

/**
 * The command git runs to merge a `.patches` file. It invokes the compiled
 * subcommand directly with the node that is running build-tools right now,
 * the same way build-tools spawns its own subcommands, rather than relying on
 * an `e` shim being on PATH inside git's shell (it usually is not for GUI git
 * clients, and `e.cmd` is not executable from Git for Windows' sh). Skipping
 * the `e` dispatcher also keeps the auto-update check out of your rebases.
 * `e sync` rewrites this on every run, so a moved checkout or a new node
 * version heals itself the next time you sync.
 */
export function patchesMergeDriverCommand(): string {
  const script = path.resolve(import.meta.dirname, '..', 'e-patch-merge-driver.js');
  return `${shellQuote(process.execPath)} ${shellQuote(script)} %O %A %B`;
}

function git(cwd: string, args: string[]): cp.SpawnSyncReturns<string> {
  return cp.spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function ensureRepoConfig(cwd: string, key: string, value: string): boolean {
  const current = git(cwd, ['config', '--local', '--get', key]);
  if (current.status === 0 && current.stdout.trimEnd() === value) return false;
  // --replace-all so a stray duplicate entry can't make plain `git config` bail out.
  const set = git(cwd, ['config', '--local', '--replace-all', key, value]);
  if (set.status !== 0) throw new Error(`git config ${key} failed: ${set.stderr.trim()}`);
  return true;
}

/**
 * Register the `.patches` list merge driver in the electron checkout at
 * `electronDir`: repo-local `merge.patches-list.*` config plus a line in
 * `$GIT_DIR/info/attributes` overriding the `merge=union` that
 * electron/electron commits in .gitattributes (kept there so checkouts without
 * build-tools still get a sane default). Idempotent, and never fatal: a missing
 * checkout just logs a warning so `e sync` / `e init` carry on.
 *
 * Returns true when anything was written.
 */
export function registerPatchesMergeDriver(electronDir: string): boolean {
  try {
    if (!fs.existsSync(path.join(electronDir, '.git'))) {
      console.warn(
        `${color.warn} ${color.path(electronDir)} is not a git checkout; skipping .patches merge driver setup`,
      );
      return false;
    }

    let changed = false;
    changed =
      ensureRepoConfig(
        electronDir,
        `merge.${PATCHES_MERGE_DRIVER_NAME}.name`,
        'electron .patches list merge',
      ) || changed;
    changed =
      ensureRepoConfig(
        electronDir,
        `merge.${PATCHES_MERGE_DRIVER_NAME}.driver`,
        patchesMergeDriverCommand(),
      ) || changed;

    // `--git-path` resolves correctly inside worktrees, where `.git` is a file
    // and info/ lives in the shared common dir.
    const gitPath = git(electronDir, ['rev-parse', '--git-path', 'info/attributes']);
    if (gitPath.status !== 0) {
      throw new Error(`git rev-parse --git-path failed: ${gitPath.stderr.trim()}`);
    }
    const attributesPath = path.resolve(electronDir, gitPath.stdout.trim());
    const existing = fs.existsSync(attributesPath) ? fs.readFileSync(attributesPath, 'utf8') : '';
    const hasAttribute = existing
      .split('\n')
      .some((line) => line.trim() === PATCHES_MERGE_ATTRIBUTE);
    if (!hasAttribute) {
      fs.mkdirSync(path.dirname(attributesPath), { recursive: true });
      const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(attributesPath, `${separator}${PATCHES_MERGE_ATTRIBUTE}\n`);
      changed = true;
    }

    if (changed) {
      console.log(
        `${color.info} Registered the .patches list merge driver in ${color.path(electronDir)}`,
      );
    }
    return changed;
  } catch (e) {
    console.warn(
      `${color.warn} Could not register the .patches merge driver: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
