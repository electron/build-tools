import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { color } from './logging.js';

export const PATCHES_MERGE_DRIVER_NAME = 'patches-list';
export const PATCHES_MERGE_ATTRIBUTE = `patches/**/.patches merge=${PATCHES_MERGE_DRIVER_NAME}`;

/**
 * Quote a path for the `sh -c` that git runs merge drivers through (Git for
 * Windows bundles sh, so this holds on every platform). POSIX single quotes
 * keep `$`, backticks and `$()` literal, unlike double quotes; an embedded `'`
 * becomes `'\''`. Backslashes are normalized to forward slashes, which node.exe
 * and Git for Windows' sh both accept and which need no escaping.
 */
export function shellQuote(p: string): string {
  return `'${p.replace(/\\/g, '/').replaceAll("'", "'\\''")}'`;
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

export interface PatchesMergeDriverInstall {
  /** True when any config or attributes were written; false if already registered. */
  changed: boolean;
  /** The `merge.patches-list.driver` command git will run. */
  driverCommand: string;
  /** Absolute path of the `info/attributes` file that carries the override line. */
  attributesPath: string;
}

/**
 * Install the `.patches` list merge driver in the git checkout at `electronDir`:
 * repo-local `merge.patches-list.*` config plus a line in
 * `$GIT_DIR/info/attributes` overriding the `merge=union` that electron/electron
 * commits in .gitattributes (kept there so checkouts without build-tools still
 * get a sane default). Idempotent. Throws if `electronDir` is not a git
 * checkout or git fails; see `registerPatchesMergeDriver` for the never-fatal
 * variant used by `e sync` / `e init`.
 */
export function installPatchesMergeDriver(electronDir: string): PatchesMergeDriverInstall {
  if (!fs.existsSync(path.join(electronDir, '.git'))) {
    throw new Error(`${electronDir} is not a git checkout`);
  }

  let changed = false;
  changed =
    ensureRepoConfig(
      electronDir,
      `merge.${PATCHES_MERGE_DRIVER_NAME}.name`,
      'electron .patches list merge',
    ) || changed;
  const driverCommand = patchesMergeDriverCommand();
  changed =
    ensureRepoConfig(electronDir, `merge.${PATCHES_MERGE_DRIVER_NAME}.driver`, driverCommand) ||
    changed;

  // `--git-path` resolves correctly inside worktrees, where `.git` is a file
  // and info/ lives in the shared common dir.
  const gitPath = git(electronDir, ['rev-parse', '--git-path', 'info/attributes']);
  if (gitPath.status !== 0) {
    throw new Error(`git rev-parse --git-path failed: ${gitPath.stderr.trim()}`);
  }
  const attributesPath = path.resolve(electronDir, gitPath.stdout.trim());
  const existing = fs.existsSync(attributesPath) ? fs.readFileSync(attributesPath, 'utf8') : '';
  const hasAttribute = existing.split('\n').some((line) => line.trim() === PATCHES_MERGE_ATTRIBUTE);
  if (!hasAttribute) {
    fs.mkdirSync(path.dirname(attributesPath), { recursive: true });
    const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(attributesPath, `${separator}${PATCHES_MERGE_ATTRIBUTE}\n`);
    changed = true;
  }

  return { changed, driverCommand, attributesPath };
}

/**
 * Register the `.patches` list merge driver in the electron checkout at
 * `electronDir` (see `installPatchesMergeDriver`). Never fatal: a missing
 * checkout or a git error just logs a warning so `e sync` / `e init` carry on.
 *
 * Returns true when anything was written.
 */
export function registerPatchesMergeDriver(electronDir: string): boolean {
  if (!fs.existsSync(path.join(electronDir, '.git'))) {
    console.warn(
      `${color.warn} ${color.path(electronDir)} is not a git checkout; skipping .patches merge driver setup`,
    );
    return false;
  }

  try {
    const { changed } = installPatchesMergeDriver(electronDir);
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
