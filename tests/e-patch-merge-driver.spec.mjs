import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatPatchList,
  mergePatchFiles,
  mergePatchLists,
  parsePatchList,
} from '../dist/e-patch-merge-driver.js';
import {
  PATCHES_MERGE_ATTRIBUTE,
  patchesMergeDriverCommand,
  registerPatchesMergeDriver,
  shellQuote,
} from '../dist/utils/patches-merge-driver.js';

const driverScript = path.resolve(import.meta.dirname, '..', 'dist', 'e-patch-merge-driver.js');

function git(cwd, ...args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function initRepo(cwd) {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.name', 'build-tools tests');
  git(cwd, 'config', 'user.email', 'build-tools@example.com');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

describe('e-patch-merge-driver', () => {
  describe('parsePatchList', () => {
    it('trims, drops blank lines, and dedupes keeping the first occurrence', () => {
      expect(parsePatchList('a.patch\n\n  b.patch \r\na.patch\nc.patch')).toEqual([
        'a.patch',
        'b.patch',
        'c.patch',
      ]);
    });
  });

  describe('mergePatchLists', () => {
    const base = ['a.patch', 'b.patch', 'c.patch', 'd.patch'];

    it('returns the shared list when neither side changed anything', () => {
      expect(mergePatchLists(base, base, base)).toEqual(base);
    });

    it('keeps a deletion made on one side', () => {
      expect(mergePatchLists(base, ['a.patch', 'c.patch', 'd.patch'], base)).toEqual([
        'a.patch',
        'c.patch',
        'd.patch',
      ]);
      expect(mergePatchLists(base, base, ['a.patch', 'b.patch', 'd.patch'])).toEqual([
        'a.patch',
        'b.patch',
        'd.patch',
      ]);
    });

    it('treats a rename as delete + add and keeps the new name in place', () => {
      const theirs = ['a.patch', 'b_renamed.patch', 'c.patch', 'd.patch'];
      expect(mergePatchLists(base, base, theirs)).toEqual(theirs);
    });

    it('keeps additions from both sides at their own positions', () => {
      const ours = ['a.patch', 'ours.patch', 'b.patch', 'c.patch', 'd.patch'];
      const theirs = ['a.patch', 'b.patch', 'c.patch', 'theirs.patch', 'd.patch'];
      expect(mergePatchLists(base, ours, theirs)).toEqual([
        'a.patch',
        'ours.patch',
        'b.patch',
        'c.patch',
        'theirs.patch',
        'd.patch',
      ]);
    });

    it('orders additions at the same anchor ours-first like union does', () => {
      const ours = [...base, 'ours1.patch', 'ours2.patch'];
      const theirs = [...base, 'theirs1.patch', 'theirs2.patch'];
      expect(mergePatchLists(base, ours, theirs)).toEqual([
        ...base,
        'ours1.patch',
        'ours2.patch',
        'theirs1.patch',
        'theirs2.patch',
      ]);
    });

    it('collapses identical additions on both sides into one entry', () => {
      const ours = ['a.patch', 'b.patch', 'new.patch', 'c.patch', 'd.patch'];
      expect(mergePatchLists(base, ours, ours)).toEqual(ours);

      // same patch added at different positions: first (ours) placement wins
      const theirs = [...base, 'new.patch'];
      expect(mergePatchLists(base, ours, theirs)).toEqual(ours);
    });

    it('re-anchors an addition whose neighbour was deleted on the other side', () => {
      // ours adds x after b; theirs deletes b -> x lands after a
      const ours = ['a.patch', 'b.patch', 'x.patch', 'c.patch', 'd.patch'];
      const theirs = ['a.patch', 'c.patch', 'd.patch'];
      expect(mergePatchLists(base, ours, theirs)).toEqual([
        'a.patch',
        'x.patch',
        'c.patch',
        'd.patch',
      ]);
    });

    it('prepends additions made at the start of the list', () => {
      const ours = ['first.patch', ...base];
      const theirs = ['zeroth.patch', ...base];
      expect(mergePatchLists(base, ours, theirs)).toEqual(['first.patch', 'zeroth.patch', ...base]);
    });

    it('drops an entry deleted on one side even if the other side moved it', () => {
      const ours = ['b.patch', 'a.patch', 'c.patch', 'd.patch'];
      const theirs = ['a.patch', 'c.patch', 'd.patch'];
      expect(mergePatchLists(base, ours, theirs)).toEqual(['a.patch', 'c.patch', 'd.patch']);
    });

    it('keeps a reorder made on either side', () => {
      const reordered = ['d.patch', 'a.patch', 'b.patch', 'c.patch'];
      expect(mergePatchLists(base, reordered, base)).toEqual(reordered);
      expect(mergePatchLists(base, base, reordered)).toEqual(reordered);
      expect(mergePatchLists(base, reordered, reordered)).toEqual(reordered);
    });

    it('is undecidable when both sides reorder differently', () => {
      const ours = ['b.patch', 'a.patch', 'c.patch', 'd.patch'];
      const theirs = ['a.patch', 'b.patch', 'd.patch', 'c.patch'];
      expect(mergePatchLists(base, ours, theirs)).toBeNull();
    });

    it('handles an empty base (file added on both sides)', () => {
      expect(mergePatchLists([], ['a.patch'], ['b.patch'])).toEqual(['a.patch', 'b.patch']);
    });
  });

  describe('formatPatchList', () => {
    it('keeps the trailing newline convention and line endings of the inputs', () => {
      expect(formatPatchList(['a', 'b'], 'a\n', 'b\n')).toBe('a\nb\n');
      expect(formatPatchList(['a', 'b'], 'a', 'b')).toBe('a\nb');
      expect(formatPatchList(['a', 'b'], 'a', 'b\n')).toBe('a\nb\n');
      expect(formatPatchList(['a', 'b'], 'a\r\nx\r\n', 'b\n')).toBe('a\r\nb\r\n');
      expect(formatPatchList([], 'a\n', 'b\n')).toBe('');
    });
  });

  describe('on disk', () => {
    let tmpdir;
    beforeEach(() => {
      tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'e-patch-merge-driver-'));
    });
    afterEach(() => {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    });

    function writeSides({ base, ours, theirs }) {
      const paths = {
        base: path.join(tmpdir, 'base'),
        ours: path.join(tmpdir, 'ours'),
        theirs: path.join(tmpdir, 'theirs'),
      };
      fs.writeFileSync(paths.base, base);
      fs.writeFileSync(paths.ours, ours);
      fs.writeFileSync(paths.theirs, theirs);
      return paths;
    }

    it('writes the list merge into the ours path', () => {
      const p = writeSides({
        base: 'a\nb\nc\n',
        ours: 'a\nb\nc\nours\n',
        theirs: 'a\nc\n',
      });
      expect(mergePatchFiles(p.base, p.ours, p.theirs)).toBe(true);
      expect(fs.readFileSync(p.ours, 'utf8')).toBe('a\nc\nours\n');
    });

    it('falls back to git merge-file --union for conflicting reorders', () => {
      const sides = { base: 'a\nb\nc\n', ours: 'b\na\nc\n', theirs: 'a\nc\nb\n' };
      const p = writeSides(sides);
      expect(mergePatchFiles(p.base, p.ours, p.theirs)).toBe(false);

      const merged = fs.readFileSync(p.ours, 'utf8');
      expect(merged).not.toContain('<<<<<<<');
      expect(new Set(merged.split('\n').filter(Boolean))).toEqual(new Set(['a', 'b', 'c']));

      // ...and it is exactly what the committed merge=union would have produced
      fs.writeFileSync(p.ours, sides.ours);
      const union = childProcess.execFileSync(
        'git',
        ['merge-file', '--union', '-p', p.ours, p.base, p.theirs],
        { encoding: 'utf8' },
      );
      expect(merged).toBe(union);
    });

    it('exits non-zero after a union fallback so git leaves the path conflicted', () => {
      const sides = { base: 'a\nb\nc\n', ours: 'b\na\nc\n', theirs: 'a\nc\nb\n' };
      const p = writeSides(sides);
      const result = childProcess.spawnSync(
        process.execPath,
        [driverScript, p.base, p.ours, p.theirs],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Conflicting reorders in ${p.ours}; fell back to a union merge`,
      );

      // %A holds the union result as a starting point for manual resolution
      const merged = fs.readFileSync(p.ours, 'utf8');
      fs.writeFileSync(p.ours, sides.ours);
      const union = childProcess.execFileSync(
        'git',
        ['merge-file', '--union', '-p', p.ours, p.base, p.theirs],
        { encoding: 'utf8' },
      );
      expect(merged).toBe(union);
    });

    it('runs as a CLI with git-style %O %A %B arguments', () => {
      const p = writeSides({
        base: 'a\nb\n',
        ours: 'a\nb\nours\n',
        theirs: 'a\nb\ntheirs\n',
      });
      const result = childProcess.spawnSync(
        process.execPath,
        [driverScript, p.base, p.ours, p.theirs],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(fs.readFileSync(p.ours, 'utf8')).toBe('a\nb\nours\ntheirs\n');
    });

    it('exits non-zero when an input is missing', () => {
      const result = childProcess.spawnSync(
        process.execPath,
        [driverScript, path.join(tmpdir, 'nope'), path.join(tmpdir, 'nope'), 'x'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ERR');
    });
  });

  describe('shellQuote', () => {
    it('single-quotes for sh so $, backticks and quotes stay literal', () => {
      expect(shellQuote('/opt/node')).toBe("'/opt/node'");
      expect(shellQuote("C:\\Program Files\\it's $HOME `dir`\\node.exe")).toBe(
        "'C:/Program Files/it'\\''s $HOME `dir`/node.exe'",
      );
    });
  });

  describe('registerPatchesMergeDriver', () => {
    let tmpdir;
    let repo;
    beforeEach(() => {
      tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'e-patch-merge-register-'));
      repo = path.join(tmpdir, 'electron');
      fs.mkdirSync(repo);
      initRepo(repo);
    });
    afterEach(() => {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    });

    it('writes repo-local config and info/attributes exactly once', () => {
      expect(registerPatchesMergeDriver(repo)).toBe(true);

      expect(git(repo, 'config', '--local', 'merge.patches-list.name')).toBe(
        'electron .patches list merge',
      );
      expect(git(repo, 'config', '--local', 'merge.patches-list.driver')).toBe(
        patchesMergeDriverCommand(),
      );
      expect(patchesMergeDriverCommand()).toMatch(/e-patch-merge-driver\.js' %O %A %B$/);

      const attributes = path.join(repo, '.git', 'info', 'attributes');
      expect(fs.readFileSync(attributes, 'utf8')).toBe(`${PATCHES_MERGE_ATTRIBUTE}\n`);

      // second run is a no-op
      expect(registerPatchesMergeDriver(repo)).toBe(false);
      expect(fs.readFileSync(attributes, 'utf8')).toBe(`${PATCHES_MERGE_ATTRIBUTE}\n`);
      expect(git(repo, 'config', '--local', '--get-all', 'merge.patches-list.driver')).toBe(
        patchesMergeDriverCommand(),
      );
    });

    it('appends to an existing info/attributes without clobbering it', () => {
      const attributes = path.join(repo, '.git', 'info', 'attributes');
      fs.mkdirSync(path.dirname(attributes), { recursive: true });
      fs.writeFileSync(attributes, '*.png binary');

      registerPatchesMergeDriver(repo);
      expect(fs.readFileSync(attributes, 'utf8')).toBe(
        `*.png binary\n${PATCHES_MERGE_ATTRIBUTE}\n`,
      );
    });

    it('resolves info/attributes through --git-path inside a worktree', () => {
      fs.writeFileSync(path.join(repo, 'README'), 'hi\n');
      git(repo, 'add', 'README');
      git(repo, 'commit', '-q', '-m', 'init');
      const worktree = path.join(tmpdir, 'wt');
      git(repo, 'worktree', 'add', '-q', worktree);

      expect(registerPatchesMergeDriver(worktree)).toBe(true);
      const attributes = path.join(repo, '.git', 'info', 'attributes');
      expect(fs.readFileSync(attributes, 'utf8')).toBe(`${PATCHES_MERGE_ATTRIBUTE}\n`);
    });

    it('warns and returns false for a directory that is not a checkout', () => {
      const notARepo = path.join(tmpdir, 'not-a-repo');
      fs.mkdirSync(notARepo);
      expect(registerPatchesMergeDriver(notARepo)).toBe(false);
    });

    it('is picked up by git merge and overrides merge=union from .gitattributes', () => {
      const patchesDir = path.join(repo, 'patches', 'chromium');
      const patchesFile = path.join(patchesDir, '.patches');
      fs.mkdirSync(patchesDir, { recursive: true });
      fs.writeFileSync(path.join(repo, '.gitattributes'), 'patches/**/.patches merge=union\n');
      fs.writeFileSync(patchesFile, 'a.patch\nb.patch\nc.patch\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'base');

      // ours: delete b.patch and append ours.patch
      fs.writeFileSync(patchesFile, 'a.patch\nc.patch\nours.patch\n');
      git(repo, 'commit', '-q', '-am', 'ours');

      // theirs: rename a.patch and append theirs.patch
      git(repo, 'checkout', '-q', '-b', 'theirs', 'HEAD~1');
      fs.writeFileSync(patchesFile, 'a_renamed.patch\nb.patch\nc.patch\ntheirs.patch\n');
      git(repo, 'commit', '-q', '-am', 'theirs');
      git(repo, 'checkout', '-q', 'main');

      registerPatchesMergeDriver(repo);
      git(repo, 'merge', '-q', '--no-edit', 'theirs');

      // union would have kept a.patch and b.patch
      expect(fs.readFileSync(patchesFile, 'utf8')).toBe(
        'a_renamed.patch\nc.patch\nours.patch\ntheirs.patch\n',
      );
    });

    it('runs through sh when the driver lives at a path with $, spaces and quotes', () => {
      // Reach dist/ through a link whose name would break double quoting: `$HOME`
      // would expand, the space would split the argument and the `'` would end it.
      const weirdDir = path.join(tmpdir, "it's $HOME dist");
      fs.symlinkSync(path.dirname(driverScript), weirdDir, 'junction');
      const weirdScript = path.join(weirdDir, path.basename(driverScript));
      const command = `${shellQuote(process.execPath)} ${shellQuote(weirdScript)} %O %A %B`;
      expect(command).toContain("it'\\''s $HOME dist");

      const patchesDir = path.join(repo, 'patches', 'chromium');
      const patchesFile = path.join(patchesDir, '.patches');
      fs.mkdirSync(patchesDir, { recursive: true });
      fs.writeFileSync(patchesFile, 'a.patch\nb.patch\nc.patch\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'base');
      fs.writeFileSync(patchesFile, 'a.patch\nc.patch\nours.patch\n');
      git(repo, 'commit', '-q', '-am', 'ours');
      git(repo, 'checkout', '-q', '-b', 'theirs', 'HEAD~1');
      fs.writeFileSync(patchesFile, 'a.patch\nb.patch\nc.patch\ntheirs.patch\n');
      git(repo, 'commit', '-q', '-am', 'theirs');
      git(repo, 'checkout', '-q', 'main');

      registerPatchesMergeDriver(repo);
      git(repo, 'config', '--local', 'merge.patches-list.driver', command);
      git(repo, 'merge', '-q', '--no-edit', 'theirs');

      expect(fs.readFileSync(patchesFile, 'utf8')).toBe(
        'a.patch\nc.patch\nours.patch\ntheirs.patch\n',
      );
    });

    it('leaves the file conflicted with the union result when reorders are undecidable', () => {
      const patchesDir = path.join(repo, 'patches', 'chromium');
      const patchesFile = path.join(patchesDir, '.patches');
      const sides = { base: 'a\nb\nc\n', ours: 'b\na\nc\n', theirs: 'a\nc\nb\n' };
      fs.mkdirSync(patchesDir, { recursive: true });
      fs.writeFileSync(patchesFile, sides.base);
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'base');
      fs.writeFileSync(patchesFile, sides.ours);
      git(repo, 'commit', '-q', '-am', 'ours');
      git(repo, 'checkout', '-q', '-b', 'theirs', 'HEAD~1');
      fs.writeFileSync(patchesFile, sides.theirs);
      git(repo, 'commit', '-q', '-am', 'theirs');
      git(repo, 'checkout', '-q', 'main');

      registerPatchesMergeDriver(repo);
      const merge = childProcess.spawnSync('git', ['merge', '--no-edit', 'theirs'], {
        cwd: repo,
        encoding: 'utf8',
      });
      expect(merge.status).not.toBe(0);
      expect(merge.stderr).toContain('fell back to a union merge');
      expect(git(repo, 'status', '--porcelain')).toContain('UU patches/chromium/.patches');

      // the working tree holds the union result as a starting point
      for (const [name, contents] of Object.entries(sides)) {
        fs.writeFileSync(path.join(tmpdir, name), contents);
      }
      const union = childProcess.execFileSync(
        'git',
        [
          'merge-file',
          '--union',
          '-p',
          ...['ours', 'base', 'theirs'].map((n) => path.join(tmpdir, n)),
        ],
        { encoding: 'utf8' },
      );
      expect(fs.readFileSync(patchesFile, 'utf8')).toBe(union);
    });
  });
});
