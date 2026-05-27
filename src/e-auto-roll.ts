#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as stream from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { program } from 'commander';
import * as inquirer from '@inquirer/prompts';
import debug from 'debug';
import extractZip from 'extract-zip';

import * as evmConfig from './evm-config.js';
import { AccessClient } from './utils/cf-access.js';
import { progressStream } from './utils/download.js';
import { color, fatal } from './utils/logging.js';

const d = debug('build-tools:auto-roll');

/** The agent-workflows dashboard/API, fronted by Cloudflare Access. */
const AGENTS_URL = new URL('https://agents.electronjs.org');
/** Branch the chromium roller pushes to (and that we replay rolls onto). */
const DEFAULT_ROLLER_BRANCH = 'roller/chromium/main';
/** Artifact name prefix the workflow uses for the git bundle. */
const BUNDLE_ARTIFACT_PREFIX = 'chromium-roll-';
const BUNDLE_FILE = 'roll.bundle';
const BUNDLE_META_FILE = 'bundle.meta';
const ROLL_SUMMARY_FILE = 'roll-summary.md';

interface RunSummary {
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  actor: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
}

interface RunsResponse {
  workflow_runs: RunSummary[];
  total_count: number;
}

interface ArtifactMeta {
  id: number;
  name: string;
  size_in_bytes: number;
  created_at: string | null;
  expired: boolean;
}

interface AutoRollOptions {
  branch: string;
  remote: string;
  fetch: boolean;
  limit: string;
  apply: boolean;
  run?: string;
}

function shortSha(sha: string): string {
  return sha.slice(0, 9);
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function apiJson<T>(client: AccessClient, requestPath: string): Promise<T> {
  const res = await client.request(requestPath, { headers: { Accept: 'application/json' } });
  if (res.status !== 200) {
    fatal(`Request to ${requestPath} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function apiText(client: AccessClient, requestPath: string): Promise<string> {
  const res = await client.request(requestPath);
  if (res.status === 404) return '';
  if (res.status !== 200) {
    fatal(`Request to ${requestPath} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** Pick the newest non-expired artifact whose name starts with the prefix. */
function pickBundleArtifact(artifacts: ArtifactMeta[]): ArtifactMeta | null {
  const matches = artifacts
    .filter((a) => a.name.startsWith(BUNDLE_ARTIFACT_PREFIX) && !a.expired)
    .sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });
  return matches[0] ?? null;
}

function parseBundleMeta(text: string): { base?: string; head?: string } {
  const meta: { base?: string; head?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'base') meta.base = m[2]!.trim();
    else if (m[1] === 'head') meta.head = m[2]!.trim();
  }
  return meta;
}

function git(
  electronDir: string,
  args: string[],
  opts: { capture?: boolean } = {},
): cp.SpawnSyncReturns<string> {
  if (!opts.capture) {
    console.log(color.childExec('git', args, { cwd: electronDir }));
  }
  return cp.spawnSync('git', args, {
    cwd: electronDir,
    encoding: 'utf8',
    stdio: opts.capture ? 'pipe' : 'inherit',
  });
}

async function downloadBundle(
  client: AccessClient,
  artifact: ArtifactMeta,
  destDir: string,
): Promise<string> {
  // The download endpoint 302s to a short-lived signed blob URL. Capture the
  // redirect ourselves so we can fetch the (non-Access) storage URL without
  // leaking the Access token to it.
  const res = await client.request(`/api/artifacts/${artifact.id}/download`);
  const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  if (!location) {
    fatal(`Unexpected response downloading artifact ${artifact.id}: ${res.status}`);
  }

  const zipPath = path.join(destDir, 'artifact.zip');
  const zipRes = await fetch(location);
  if (!zipRes.ok || !zipRes.body) {
    fatal(`Failed to download artifact zip: ${zipRes.status} ${zipRes.statusText}`);
  }

  const total = Number(zipRes.headers.get('content-length') ?? 0);
  const source = stream.Readable.fromWeb(
    zipRes.body as Parameters<typeof stream.Readable.fromWeb>[0],
  );
  const out = fs.createWriteStream(zipPath);
  if (total > 0 && process.stdout.isTTY) {
    await pipeline(source, progressStream(total, '  [:bar] :mbRateMB/s :percent :etas'), out);
  } else {
    await pipeline(source, out);
  }

  const extractDir = path.join(destDir, 'extracted');
  await extractZip(zipPath, { dir: extractDir });
  const bundlePath = path.join(extractDir, BUNDLE_FILE);
  if (!fs.existsSync(bundlePath)) {
    fatal(`Artifact ${artifact.name} did not contain ${BUNDLE_FILE}`);
  }
  return extractDir;
}

/**
 * Bring the local roller branch in line with its upstream before applying:
 * fetch the latest `rollerBranch` from `remote`, then move `localBranch` to
 * that tip. This is what makes the roll's base commit available locally.
 *
 * Creating the branch or fast-forwarding it is non-destructive and happens
 * silently. A hard reset that would *discard* local commits (the branch has
 * diverged from upstream) prompts for confirmation first.
 */
async function syncRollerBranch(
  electronDir: string,
  remote: string,
  rollerBranch: string,
  localBranch: string,
): Promise<void> {
  console.log(`${color.info} Fetching latest ${color.config(`${remote}/${rollerBranch}`)}…`);
  if (git(electronDir, ['fetch', remote, rollerBranch]).status !== 0) {
    fatal(`Failed to fetch ${rollerBranch} from ${remote}`);
  }
  const remoteTip = git(electronDir, ['rev-parse', 'FETCH_HEAD'], { capture: true }).stdout.trim();
  if (!remoteTip) fatal('Could not resolve the fetched roller branch tip (FETCH_HEAD)');

  const localExists =
    git(electronDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${localBranch}`], {
      capture: true,
    }).status === 0;

  if (!localExists) {
    console.log(
      `${color.info} Creating ${color.config(localBranch)} at ${color.git(shortSha(remoteTip))}`,
    );
    if (git(electronDir, ['checkout', '-b', localBranch, remoteTip]).status !== 0) {
      fatal(`Could not create ${localBranch} at ${shortSha(remoteTip)}`);
    }
    return;
  }

  const localTip = git(electronDir, ['rev-parse', localBranch], { capture: true }).stdout.trim();
  if (localTip === remoteTip) {
    if (git(electronDir, ['checkout', localBranch]).status !== 0) {
      fatal(`Could not check out ${localBranch}`);
    }
    console.log(
      `${color.info} ${color.config(localBranch)} is already at the latest ${rollerBranch}`,
    );
    return;
  }

  // Commits on the local branch the upstream tip can't reach — i.e. work that a
  // hard reset would throw away.
  const lost = git(electronDir, ['rev-list', `${remoteTip}..${localTip}`], {
    capture: true,
  }).stdout.trim();

  if (lost) {
    const lostLog = git(electronDir, ['log', '--oneline', `${remoteTip}..${localTip}`], {
      capture: true,
    }).stdout.trim();
    console.log(
      `\n${color.warn} ${color.config(localBranch)} has local commits that aren't on ${remote}/${rollerBranch}:\n\n${lostLog}\n`,
    );
    const ok = await inquirer.confirm({
      default: false,
      message: `Hard-reset ${localBranch} to ${shortSha(remoteTip)} and DISCARD the ${lost.split('\n').length} commit(s) above?`,
    });
    if (!ok) {
      fatal(
        `Aborted to preserve your local commits. Push or stash them, or re-run with a different ${color.cmd('--branch')}.`,
      );
    }
  }

  if (git(electronDir, ['checkout', localBranch]).status !== 0) {
    fatal(`Could not check out ${localBranch}`);
  }
  if (git(electronDir, ['reset', '--hard', remoteTip]).status !== 0) {
    fatal(`Could not reset ${localBranch} to ${shortSha(remoteTip)}`);
  }
  console.log(
    `${color.success} ${color.config(localBranch)} reset to latest ${rollerBranch} ` +
      `(${color.git(shortSha(remoteTip))})`,
  );
}

function applyRoll(
  electronDir: string,
  extractDir: string,
  branch: string,
  runId: number,
  remote: string,
): void {
  const bundlePath = path.join(extractDir, BUNDLE_FILE);
  const metaPath = path.join(extractDir, BUNDLE_META_FILE);

  const meta = fs.existsSync(metaPath) ? parseBundleMeta(fs.readFileSync(metaPath, 'utf8')) : {};
  if (!meta.base || !meta.head) {
    fatal(`${BUNDLE_META_FILE} is missing base/head — refusing to apply an unverifiable bundle`);
  }
  const { base, head } = meta as { base: string; head: string };

  // The bundle is rooted at the roller/chromium/main tip the roll was built
  // from. If our checkout doesn't already have that commit, fetch it by SHA —
  // it's a real commit on the remote (unless the roller branch has since been
  // force-pushed past this roll, in which case it's been GC'd).
  const haveBase = () =>
    git(electronDir, ['cat-file', '-e', `${base}^{commit}`], { capture: true }).status === 0;
  if (!haveBase()) {
    console.log(`${color.info} Fetching the roll's base commit ${shortSha(base)} from ${remote}…`);
    git(electronDir, ['fetch', remote, base], { capture: true });
  }

  // Verify the bundle is self-consistent and its prerequisite (base) commit is
  // present before we touch any branch.
  const verify = git(electronDir, ['bundle', 'verify', bundlePath], { capture: true });
  if (verify.status !== 0 || !haveBase()) {
    if (verify.stderr || verify.stdout) console.error(verify.stderr || verify.stdout);
    fatal(
      `The roll's base commit ${shortSha(base)} isn't available on ${remote}. The roller branch ` +
        `was likely force-pushed past this roll (its base has been garbage-collected) — pick a ` +
        `more recent roll.`,
    );
  }

  const tempRef = `refs/auto-roll/${runId}`;
  if (git(electronDir, ['fetch', bundlePath, `${head}:${tempRef}`]).status !== 0) {
    fatal('Failed to fetch the roll commits out of the bundle');
  }

  // Ensure the target branch exists; anchor a new one at base if it doesn't.
  const branchExists =
    git(electronDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      capture: true,
    }).status === 0;
  if (!branchExists) {
    console.log(
      `${color.warn} Local branch ${color.config(branch)} doesn't exist — creating it at the roll's base ${shortSha(base)}`,
    );
    if (git(electronDir, ['branch', branch, base]).status !== 0) {
      fatal(`Could not create branch ${branch} at ${shortSha(base)}`);
    }
  }

  if (git(electronDir, ['checkout', branch]).status !== 0) {
    fatal(`Could not check out ${branch}`);
  }

  const branchTip = git(electronDir, ['rev-parse', branch], { capture: true }).stdout.trim();

  let applied: cp.SpawnSyncReturns<string>;
  if (branchTip === base) {
    // Local branch is exactly where the roll started — fast-forward.
    console.log(`${color.info} ${color.config(branch)} is at the roll base; fast-forwarding`);
    applied = git(electronDir, ['merge', '--ff-only', tempRef]);
  } else {
    // Branch has diverged from the roll's base — replay the roll's commits on
    // top of wherever the branch is now.
    console.log(
      `${color.info} Replaying roll commits ${shortSha(base)}..${shortSha(head)} onto ${color.config(branch)}`,
    );
    applied = git(electronDir, ['cherry-pick', `${base}..${tempRef}`]);
  }

  if (applied.status !== 0) {
    console.error(
      `\n${color.err} Applying the roll hit a conflict. The bundle ref is kept at ` +
        `${color.config(tempRef)} for reference.\n` +
        `Resolve the conflicts, then ${color.cmd('git cherry-pick --continue')} ` +
        `(or ${color.cmd('git cherry-pick --abort')} to back out).`,
    );
    process.exit(applied.status ?? 1);
  }

  // Success — drop the temporary bundle ref and report the new tip.
  git(electronDir, ['update-ref', '-d', tempRef], { capture: true });
  const newTip = git(electronDir, ['rev-parse', branch], { capture: true }).stdout.trim();
  console.log(
    `\n${color.success} ${color.config(branch)} now at ${color.git(shortSha(newTip))} ` +
      `(roll head ${shortSha(head)})`,
  );
}

program
  .description(
    'List Chromium auto-rolls produced by the agent-workflows service, download one, and apply it on top of the local roller branch',
  )
  .option('--branch <name>', 'Local roller branch to apply onto', DEFAULT_ROLLER_BRANCH)
  .option('--remote <name>', 'Remote to fetch the roller branch from', 'origin')
  .option(
    '--no-fetch',
    "Don't fetch/reset the roller branch to its latest upstream before applying",
  )
  .option('--limit <n>', 'How many recent runs to list', '30')
  .option('--run <id>', 'Skip the picker and use this workflow run id directly')
  .option('--no-apply', 'Download and extract the bundle but do not apply it')
  .action(async (options: AutoRollOptions) => {
    const config = evmConfig.current();
    const electronDir = path.resolve(config.root, 'src', 'electron');
    if (!fs.existsSync(path.join(electronDir, '.git'))) {
      fatal(
        `No Electron checkout found at ${color.path(electronDir)} — run ${color.cmd('e sync')} first`,
      );
    }

    // Refuse to apply onto a dirty tree; we won't risk clobbering local work.
    if (options.apply) {
      const status = git(electronDir, ['status', '--porcelain'], { capture: true });
      if (status.status !== 0 || status.stdout.trim().length !== 0) {
        fatal(
          "Your Electron working tree isn't clean. Commit or stash your changes (or pass " +
            `${color.cmd('--no-apply')} to just download) and try again.`,
        );
      }
    }

    const client = await AccessClient.create(AGENTS_URL);

    // Resolve which run to download.
    let runId: number;
    if (options.run) {
      runId = Number(options.run);
      if (!Number.isInteger(runId))
        fatal(`--run must be a numeric workflow run id, got "${options.run}"`);
    } else {
      const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
      console.log(`${color.info} Fetching recent Chromium auto-rolls…`);
      const runs = await apiJson<RunsResponse>(
        client,
        `/api/chromium-upgrade/runs?perPage=${limit}&warm=false`,
      );
      const successful = runs.workflow_runs.filter(
        (r) => r.status === 'completed' && r.conclusion === 'success',
      );
      if (successful.length === 0) {
        fatal('No successful auto-roll runs found to download.');
      }

      runId = await inquirer.select({
        message: 'Which auto-roll do you want to download?',
        choices: successful.map((r) => ({
          name: `#${r.run_number}  ${timeAgo(r.run_started_at ?? r.created_at).padEnd(8)}  ${shortSha(r.head_sha)}  ${r.actor ?? '—'}`,
          value: r.id,
          description: r.html_url,
        })),
      });
    }

    // Find the bundle artifact for the chosen run.
    const artifacts = await apiJson<ArtifactMeta[]>(
      client,
      `/api/chromium-upgrade/runs/${runId}/artifacts`,
    );
    const bundle = pickBundleArtifact(artifacts);
    if (!bundle) {
      fatal(
        `Run ${runId} has no downloadable ${BUNDLE_ARTIFACT_PREFIX}* bundle. It may have produced ` +
          'no changes, failed before bundling, or its artifact expired (14-day retention).',
      );
    }
    d('selected bundle artifact %o', bundle);

    // Show the agent's summary + base/head and confirm before downloading.
    const summary = await apiText(
      client,
      `/api/artifacts/${bundle.id}/file?name=${ROLL_SUMMARY_FILE}`,
    );
    const metaText = await apiText(
      client,
      `/api/artifacts/${bundle.id}/file?name=${BUNDLE_META_FILE}`,
    );
    const meta = parseBundleMeta(metaText);
    const sizeMb = (bundle.size_in_bytes / (1024 * 1024)).toFixed(1);

    console.log(`\n${color.info} ${bundle.name} (${sizeMb} MB)`);
    if (meta.base && meta.head) {
      console.log(
        `       base ${color.git(shortSha(meta.base))} → head ${color.git(shortSha(meta.head))}`,
      );
    }
    if (summary.trim()) {
      const preview = summary.trim().split(/\r?\n/).slice(0, 12).join('\n');
      console.log(`\n${preview}\n`);
    }

    if (!options.apply) {
      const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-auto-roll-'));
      const extractDir = await downloadBundle(client, bundle, destDir);
      console.log(
        `${color.success} Downloaded and extracted to ${color.path(extractDir)} ` +
          `(not applied — ${color.cmd('--no-apply')})`,
      );
      return;
    }

    const proceed = await inquirer.confirm({
      default: true,
      message: `Download this roll and apply it onto ${options.branch}?`,
    });
    if (!proceed) {
      console.log(`${color.info} Aborted.`);
      return;
    }

    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-auto-roll-'));
    try {
      // Fetch the latest roller branch (and bring the local branch up to it) so
      // the roll's base commit is present before we try to apply it.
      if (options.fetch) {
        await syncRollerBranch(electronDir, options.remote, DEFAULT_ROLLER_BRANCH, options.branch);
      }
      const extractDir = await downloadBundle(client, bundle, destDir);
      applyRoll(electronDir, extractDir, options.branch, runId, options.remote);
    } finally {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
  });

if (import.meta.main) {
  program.parse(process.argv);
}
