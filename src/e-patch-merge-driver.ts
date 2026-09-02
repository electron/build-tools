#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as fs from 'node:fs';

import { Command } from 'commander';

import { color } from './utils/logging.js';

// A git merge driver for electron/electron's `patches/**/.patches` files.
//
// Each `.patches` file is a newline-separated list of patch filenames in apply
// order. electron/electron ships `merge=union` for them in .gitattributes,
// which is close but not quite right: union keeps every line from both sides,
// so a patch that was deleted or renamed on one side survives the merge (and
// then fails to apply), and a line added on both sides shows up twice.
//
// This driver treats the file as what it is - an ordered set - and performs a
// three-way list merge instead. `e sync` registers it in the electron checkout
// (see utils/patches-merge-driver.ts).

/** Split a `.patches` file into its entries: trimmed, non-blank, first occurrence wins. */
export function parsePatchList(contents: string): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    entries.push(line);
  }
  return entries;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * Three-way merge of ordered patch lists.
 *
 * Rules:
 *  - An entry present in base and removed on either side stays removed.
 *  - Entries added on either side are kept, positioned after the nearest
 *    preceding entry of that side's list that survives the merge (walking
 *    back past deleted neighbours; at the start of the list -> prepend). When
 *    both sides add entries at the same anchor, ours come first, then theirs,
 *    matching git's union ordering.
 *  - Duplicates collapse to the first occurrence, so the same patch added on
 *    both sides appears once (at the position ours gave it).
 *  - If exactly one side reordered the surviving base entries, that order
 *    wins. If both sides reordered them identically, that order wins.
 *
 * Returns null when the merge is undecidable, which concretely means: both
 * sides reordered the surviving base entries and disagree about the result
 * (e.g. ours moved `a` after `b`, theirs moved `c` before `a`). There is no
 * way to pick one ordering without silently discarding one side's intent, so
 * the caller falls back to a plain union merge for a human to look at.
 */
export function mergePatchLists(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
): string[] | null {
  const inBase = new Set(base);
  const inOurs = new Set(ours);
  const inTheirs = new Set(theirs);

  // Base entries that survive on both sides, in each list's order.
  const survives = (entry: string): boolean =>
    inBase.has(entry) && inOurs.has(entry) && inTheirs.has(entry);
  const baseKept = base.filter(survives);
  const oursKept = ours.filter(survives);
  const theirsKept = theirs.filter(survives);

  let skeleton: string[];
  if (sameOrder(oursKept, baseKept)) {
    skeleton = theirsKept; // theirs may or may not have reordered; either way it wins
  } else if (sameOrder(theirsKept, baseKept)) {
    skeleton = oursKept;
  } else if (sameOrder(oursKept, theirsKept)) {
    skeleton = oursKept;
  } else {
    return null; // conflicting reorders on both sides: undecidable
  }

  const result = [...skeleton];
  const insertAdditions = (side: readonly string[]): void => {
    for (let i = 0; i < side.length; ++i) {
      const entry = side[i]!;
      if (inBase.has(entry) || result.includes(entry)) continue;

      // Anchor: nearest preceding entry from this side that made it into the result.
      let anchor = -1;
      for (let j = i - 1; j >= 0 && anchor === -1; --j) {
        anchor = result.indexOf(side[j]!);
      }
      // Skip past additions already placed directly after the anchor so that
      // blocks added at the same spot stay contiguous and in insertion order.
      while (anchor + 1 < result.length && !inBase.has(result[anchor + 1]!)) {
        ++anchor;
      }
      result.splice(anchor + 1, 0, entry);
    }
  };
  insertAdditions(ours);
  insertAdditions(theirs);

  return result;
}

/** Serialize a merged list using the line-ending conventions of the inputs. */
export function formatPatchList(entries: readonly string[], ours: string, theirs: string): string {
  if (entries.length === 0) return '';
  const eol = ours.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /\r?\n$/.test(ours) || /\r?\n$/.test(theirs);
  return entries.join(eol) + (trailingNewline ? eol : '');
}

/**
 * Merge `.patches` files on disk, writing the result to `oursPath` (git's %A).
 * Returns true when the list merge succeeded and false when it fell back to
 * `git merge-file --union`, which is what the committed .gitattributes would
 * have done anyway, so the driver is never worse than the default.
 */
export function mergePatchFiles(basePath: string, oursPath: string, theirsPath: string): boolean {
  const base = fs.readFileSync(basePath, 'utf8');
  const ours = fs.readFileSync(oursPath, 'utf8');
  const theirs = fs.readFileSync(theirsPath, 'utf8');

  const merged = mergePatchLists(
    parsePatchList(base),
    parsePatchList(ours),
    parsePatchList(theirs),
  );
  if (merged !== null) {
    fs.writeFileSync(oursPath, formatPatchList(merged, ours, theirs));
    return true;
  }

  // git merge-file <current> <base> <other>; --union resolves every hunk by
  // taking both sides (exit status 0), -p prints the result instead of
  // rewriting <current> in place.
  const union = cp.spawnSync(
    'git',
    ['merge-file', '--union', '-p', oursPath, basePath, theirsPath],
    { encoding: 'utf8' },
  );
  if (union.error) throw union.error;
  if (union.status === null || union.status < 0) {
    throw new Error(`git merge-file failed: ${union.stderr}`);
  }
  fs.writeFileSync(oursPath, union.stdout);
  return false;
}

const program = new Command();

program
  .argument('<base>', 'common ancestor version (%O)')
  .argument('<ours>', 'current branch version (%A); the merge result is written here')
  .argument('<theirs>', 'other branch version (%B)')
  .description(
    'Git merge driver for electron patches/**/.patches files that merges them as ordered lists',
  )
  .action((base: string, ours: string, theirs: string) => {
    try {
      if (!mergePatchFiles(base, ours, theirs)) {
        console.error(
          `${color.warn} Conflicting reorders in ${color.path(ours)}; fell back to a union merge`,
        );
      }
    } catch (e) {
      // A failing merge driver leaves the path conflicted for the user to resolve.
      console.error(`${color.err} ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  })
  .on('--help', () => {
    console.log('');
    console.log('This command is registered as a git merge driver by `e sync`; you should not');
    console.log('need to run it by hand. Git invokes it as:');
    console.log('');
    console.log('  $ e patch-merge-driver %O %A %B');
  });

if (import.meta.main) {
  program.parse(process.argv);
}
