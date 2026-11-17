import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import type { SanitizedConfig } from '../types.js';

// siso -weights_file support.
//
// siso schedules ready steps by the largest sum of step weights on the path to
// the targets. By default every step weighs 1, so a deep chain of cheap steps
// (blink compiles -> archives) beats a short chain of slow ones (the
// v8_context_snapshot_generator link, snapshot, code cache, final link). A
// weights file gives each output the milliseconds its step took last time.
//
// Sources, first that exists wins:
//   1. $ELECTRON_SISO_WEIGHTS_FILE (or "0" to disable weights),
//   2. <out dir>/siso_weights.json.gz, learned from this out dir's previous builds,
//   3. tools/siso-weights/<platform>-<arch>.json.gz shipped with build-tools.
// Outputs missing from the file (new, renamed) fall back to the file's
// per-rule medians and default, and a missing or unreadable file only logs a
// warning in siso, so stale weights cannot break a build.

const LEARNED = 'siso_weights.json.gz';
const MIN_RULE_SAMPLES = 20;

// Same as evmConfig.outDir(). Importing evm-config here would pull it into
// siso.ts's imports, which breaks evm-config.spec's depot-tools mock when the
// spec files share a worker.
function outDir(config: Pick<SanitizedConfig, 'root' | 'gen'>): string {
  return path.resolve(config.root, 'src', 'out', config.gen.out);
}

export function seedFile(): string {
  return path.resolve(
    import.meta.dirname,
    '../../tools/siso-weights',
    `${process.platform}-${process.arch}.json.gz`,
  );
}

export function weightsFile(
  config: Pick<SanitizedConfig, 'root' | 'gen'>,
  seed: string = seedFile(),
): string | undefined {
  const env = process.env['ELECTRON_SISO_WEIGHTS_FILE'];
  if (env === '0') return undefined;
  // siso resolves a relative -weights_file against src/, not our cwd.
  const candidates = [
    env ? path.resolve(env) : undefined,
    config.root && config.gen?.out ? path.join(outDir(config), LEARNED) : undefined,
    seed,
  ];
  for (const f of candidates) {
    if (f && fs.existsSync(f)) return f;
  }
  return undefined;
}

interface WeightsFile {
  outputs: Record<string, number>;
  rules?: { action: string; weight: number }[];
  default?: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 1;
}

function escapeRE2(s: string): string {
  return s.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

// updateLearnedWeights merges <out dir>/siso_metrics.json of the build that
// just finished into <out dir>/siso_weights.json.gz. Outputs that did not run
// (up to date) keep their previous weight. Never throws: weights are a
// scheduling hint only.
export function updateLearnedWeights(config: Pick<SanitizedConfig, 'root' | 'gen'>): void {
  try {
    const dir = outDir(config);
    const metricsPath = path.join(dir, 'siso_metrics.json');
    const learnedPath = path.join(dir, LEARNED);
    if (!fs.existsSync(metricsPath)) return;
    let outputs: Record<string, number> = {};
    let oldRules: WeightsFile['rules'] = [];
    try {
      const old = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(learnedPath)).toString(),
      ) as Partial<WeightsFile>;
      if (old.outputs && typeof old.outputs === 'object') {
        outputs = old.outputs;
        if (Array.isArray(old.rules)) oldRules = old.rules;
      }
    } catch {
      // Missing or unreadable: start over rather than never learning again.
    }
    const byAction = new Map<string, number[]>();
    for (const line of fs.readFileSync(metricsPath, 'utf8').split('\n')) {
      if (!line) continue;
      let m: {
        outputs?: string[];
        action?: string;
        no_exec?: boolean;
        err?: boolean;
        action_start_nanos?: number;
        action_end_nanos?: number;
      };
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (!m || typeof m !== 'object') continue;
      const { action_start_nanos: s, action_end_nanos: e } = m;
      if (!m.outputs?.length || m.no_exec || m.err || s === undefined || e === undefined || e < s)
        continue;
      const w = Math.max(1, Math.round((e - s) / 1e6));
      for (const o of m.outputs) outputs[o] = w;
      if (m.action) {
        const ws = byAction.get(m.action);
        if (ws) ws.push(w);
        else byAction.set(m.action, [w]);
      }
    }
    const all = Object.values(outputs);
    if (all.length === 0) return;
    const rules = [...byAction.entries()]
      .filter(([, ws]) => ws.length >= MIN_RULE_SAMPLES)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([action, ws]) => ({ action: escapeRE2(action), weight: Math.max(1, median(ws)) }));
    // An incremental build runs too few steps per rule; keep earlier rules.
    const seen = new Set(rules.map((r) => r.action));
    rules.push(...oldRules.filter((r) => !seen.has(r.action)));
    const file: WeightsFile = { outputs, rules, default: Math.max(1, median(all)) };
    const tmp = `${learnedPath}.tmp`;
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(file)));
    fs.renameSync(tmp, learnedPath);
  } catch (e) {
    console.warn(`siso weights: not updated: ${e}`);
  }
}
