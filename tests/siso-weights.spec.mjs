import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setUsingRemote } from '../dist/utils/reclient.js';
import { flags } from '../dist/utils/siso.js';
import {
  seedFile,
  updateLearnedWeights,
  weightsEnv,
  weightsFile,
} from '../dist/utils/siso-weights.js';

const ENV = 'ELECTRON_SISO_WEIGHTS_FILE';

// One siso_metrics.json line: a step that took `ms` milliseconds.
const step = (action, outputs, ms, extra = {}) => ({
  action,
  outputs,
  action_start_nanos: 5e9,
  action_end_nanos: 5e9 + ms * 1e6,
  ...extra,
});

describe('siso weights', () => {
  let root;
  let config;
  let savedEnv;
  const outDir = () => path.join(root, 'src', 'out', 'Testing');
  const learned = () => path.join(outDir(), 'siso_weights.json.gz');
  const metrics = () => path.join(outDir(), 'siso_metrics.json');
  const missingSeed = () => path.join(root, 'no-seed.json.gz');

  const touch = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    return file;
  };
  const writeMetrics = (lines) =>
    fs.writeFileSync(
      metrics(),
      lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
    );
  const readLearned = () => JSON.parse(zlib.gunzipSync(fs.readFileSync(learned())).toString());

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'siso-weights-'));
    fs.mkdirSync(outDir(), { recursive: true });
    config = { remoteBuild: 'siso', root, gen: { out: 'Testing' } };
    savedEnv = process.env[ENV];
    delete process.env[ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = savedEnv;
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('weightsFile', () => {
    it('returns nothing when no weights file exists', () => {
      expect(weightsFile(config, missingSeed())).toBeUndefined();
    });

    it('prefers ELECTRON_SISO_WEIGHTS_FILE over the learned and seed files', () => {
      const envFile = touch(path.join(root, 'env.json.gz'));
      touch(learned());
      const seed = touch(path.join(root, 'seed.json.gz'));
      process.env[ENV] = envFile;
      expect(weightsFile(config, seed)).toBe(envFile);
    });

    it('makes a relative ELECTRON_SISO_WEIGHTS_FILE absolute', () => {
      const envFile = touch(path.join(root, 'env.json.gz'));
      process.env[ENV] = path.relative(process.cwd(), envFile);
      expect(weightsFile(config, missingSeed())).toBe(envFile);
    });

    it('falls back past a missing ELECTRON_SISO_WEIGHTS_FILE', () => {
      process.env[ENV] = path.join(root, 'missing.json.gz');
      touch(learned());
      expect(weightsFile(config, missingSeed())).toBe(learned());
    });

    it('prefers the learned file over the seed', () => {
      touch(learned());
      const seed = touch(path.join(root, 'seed.json.gz'));
      expect(weightsFile(config, seed)).toBe(learned());
    });

    it('uses the seed when nothing else exists', () => {
      const seed = touch(path.join(root, 'seed.json.gz'));
      expect(weightsFile(config, seed)).toBe(seed);
    });

    it('disables weights when ELECTRON_SISO_WEIGHTS_FILE is 0', () => {
      touch(learned());
      const seed = touch(path.join(root, 'seed.json.gz'));
      process.env[ENV] = '0';
      expect(weightsFile(config, seed)).toBeUndefined();
    });

    it('returns an absolute learned path', () => {
      touch(learned());
      expect(path.isAbsolute(weightsFile(config, missingSeed()))).toBe(true);
    });

    it('does not need an out dir', () => {
      const seed = touch(path.join(root, 'seed.json.gz'));
      expect(weightsFile({ remoteBuild: 'siso' }, seed)).toBe(seed);
    });

    it('looks for the seed in build-tools/tools/siso-weights', () => {
      expect(seedFile()).toBe(
        path.resolve(
          import.meta.dirname,
          '..',
          'tools',
          'siso-weights',
          `${process.platform}-${process.arch}.json.gz`,
        ),
      );
    });
  });

  describe('weightsEnv', () => {
    const weights = () => ({ SISO_WEIGHTS_FILE: learned() });

    it('passes the learned weights file to siso through SISO_WEIGHTS_FILE', () => {
      touch(learned());
      expect(weightsEnv(config, [], {})).toEqual(weights());
    });

    it('never passes -weights_file, which an older siso rejects', () => {
      touch(learned());
      expect(flags(config, true).filter((arg) => String(arg).includes('weights_file'))).toEqual([]);
    });

    it('passes nothing when there is no weights file', () => {
      expect(weightsEnv(config, [], {})).toEqual({});
    });

    it('passes nothing when ELECTRON_SISO_WEIGHTS_FILE is 0', () => {
      touch(learned());
      process.env[ENV] = '0';
      expect(weightsEnv(config, [], {})).toEqual({});
    });

    it('passes nothing for other backends', () => {
      touch(learned());
      expect(weightsEnv({ ...config, remoteBuild: 'none' }, [], {})).toEqual({});
    });

    it('also weights local-only (--no-remote) builds', () => {
      touch(learned());
      setUsingRemote(false);
      try {
        expect(weightsEnv(config, ['-C', 'out/Testing'], {})).toEqual(weights());
      } finally {
        setUsingRemote(true);
      }
    });

    it.each([
      [['-weights_file', 'mine.json']],
      [['-weights_file=mine.json']],
      [['--weights_file', 'mine.json']],
      [['--weights_file=mine.json']],
    ])('passes nothing when the user passes %j', (userArgs) => {
      touch(learned());
      expect(weightsEnv(config, userArgs, {})).toEqual({});
    });

    it('is not fooled by other flags', () => {
      touch(learned());
      expect(weightsEnv(config, ['-weights_file_foo=1'], {})).toEqual(weights());
    });

    it('keeps a SISO_WEIGHTS_FILE set in the shell', () => {
      touch(learned());
      expect(weightsEnv(config, [], { SISO_WEIGHTS_FILE: '/mine.json' })).toEqual({});
      expect(weightsEnv(config, [], { SISO_WEIGHTS_FILE: '' })).toEqual({});
    });

    it('keeps a SISO_WEIGHTS_FILE set in the config env', () => {
      touch(learned());
      const withEnv = { ...config, env: { SISO_WEIGHTS_FILE: '/mine.json' } };
      expect(weightsEnv(withEnv, [], {})).toEqual({});
    });
  });

  describe('updateLearnedWeights', () => {
    it('does nothing without siso_metrics.json', () => {
      updateLearnedWeights(config);
      expect(fs.existsSync(learned())).toBe(false);
    });

    it('records each output with its step duration in ms', () => {
      writeMetrics([
        step('cxx', ['obj/a.o'], 812),
        step('link', ['electron', 'electron.debug'], 18000),
        step('stamp', ['obj/fast.stamp'], 0.2),
      ]);
      updateLearnedWeights(config);
      expect(readLearned().outputs).toEqual({
        'obj/a.o': 812,
        electron: 18000,
        'electron.debug': 18000,
        'obj/fast.stamp': 1,
      });
    });

    it('skips no_exec, failed, untimed and malformed steps', () => {
      writeMetrics([
        step('cxx', ['obj/ok.o'], 100),
        step('phony', ['obj/phony'], 100, { no_exec: true }),
        step('cxx', ['obj/failed.o'], 100, { err: true }),
        { action: 'cxx', outputs: ['obj/no-start.o'], action_end_nanos: 1e9 },
        { action: 'cxx', outputs: ['obj/no-end.o'], action_start_nanos: 1e9 },
        step('cxx', ['obj/backwards.o'], -5),
        step('cxx', [], 100),
        '{"action": "cxx", "outputs": ["obj/trunc',
        'null',
        '42',
        step('cxx', ['obj/after.o'], 200),
      ]);
      updateLearnedWeights(config);
      expect(readLearned().outputs).toEqual({ 'obj/ok.o': 100, 'obj/after.o': 200 });
    });

    it('keeps the weights of outputs that did not run', () => {
      writeMetrics([step('cxx', ['obj/a.o'], 100), step('cxx', ['obj/b.o'], 200)]);
      updateLearnedWeights(config);
      writeMetrics([step('cxx', ['obj/b.o'], 300), step('cxx', ['obj/c.o'], 400)]);
      updateLearnedWeights(config);
      expect(readLearned().outputs).toEqual({ 'obj/a.o': 100, 'obj/b.o': 300, 'obj/c.o': 400 });
    });

    it('keeps earlier rules that the new build has too few samples for', () => {
      writeMetrics(Array.from({ length: 21 }, (_, i) => step('cxx', [`obj/${i}.o`], 100)));
      updateLearnedWeights(config);
      writeMetrics([
        step('cxx', ['obj/0.o'], 500),
        ...Array.from({ length: 21 }, (_, i) => step('alink', [`obj/${i}.a`], 30)),
      ]);
      updateLearnedWeights(config);
      expect(readLearned().rules).toEqual([
        { action: 'alink', weight: 30 },
        { action: 'cxx', weight: 100 },
      ]);
    });

    it('adds a median rule for each ninja rule with at least 20 samples', () => {
      writeMetrics([
        ...Array.from({ length: 21 }, (_, i) => step('cxx', [`obj/${i}.o`], 100 + i)),
        ...Array.from({ length: 20 }, (_, i) => step('python.py+', [`gen/${i}.h`], 7)),
        ...Array.from({ length: 19 }, (_, i) => step('alink', [`obj/${i}.a`], 50)),
      ]);
      updateLearnedWeights(config);
      expect(readLearned().rules).toEqual([
        { action: 'cxx', weight: 110 },
        { action: 'python\\.py\\+', weight: 7 },
      ]);
    });

    it('sets the default to the median of all output weights', () => {
      writeMetrics([
        step('cxx', ['obj/a.o'], 10),
        step('cxx', ['obj/b.o'], 30),
        step('link', ['electron'], 9000),
      ]);
      updateLearnedWeights(config);
      expect(readLearned().default).toBe(30);
    });

    it.each([
      ['not gzip', () => fs.writeFileSync(learned(), 'garbage')],
      ['bad JSON', () => fs.writeFileSync(learned(), zlib.gzipSync('{"outputs": '))],
      ['no outputs', () => fs.writeFileSync(learned(), zlib.gzipSync('{"default": 3}'))],
    ])('replaces a learned file with %s without throwing', (_, corrupt) => {
      corrupt();
      writeMetrics([step('cxx', ['obj/a.o'], 100)]);
      expect(() => updateLearnedWeights(config)).not.toThrow();
      expect(readLearned().outputs).toEqual({ 'obj/a.o': 100 });
    });

    it('never throws', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => updateLearnedWeights({})).not.toThrow();
      fs.mkdirSync(metrics());
      expect(() => updateLearnedWeights(config)).not.toThrow();
      expect(fs.existsSync(learned())).toBe(false);
    });

    it('writes a file in the format siso reads, end to end', () => {
      const clean = [
        ...Array.from({ length: 40 }, (_, i) => step('cxx', [`obj/blink/${i}.o`], 300 + i * 7)),
        ...Array.from({ length: 25 }, (_, i) => step('alink', [`obj/blink/lib${i}.a`], 40 + i)),
        ...Array.from({ length: 5 }, (_, i) => step('rust/run_build_script', [`gen/rs/${i}`], 900)),
        step('link', ['v8_context_snapshot_generator'], 18000),
        step('action', ['v8_context_snapshot.bin'], 6000),
        step('link', ['electron', 'electron.debug'], 25000),
        step('phony', ['all'], 0, { no_exec: true }),
      ];
      writeMetrics(clean);
      updateLearnedWeights(config);
      expect(readLearned().rules).toEqual([
        { action: 'cxx', weight: 440 },
        { action: 'alink', weight: 52 },
      ]);
      // An incremental build re-runs only a few steps.
      writeMetrics([clean[3], clean[70], step('cxx', ['obj/new.o'], 450)]);
      updateLearnedWeights(config);

      const file = readLearned();
      expect(Object.keys(file).sort()).toEqual(['default', 'outputs', 'rules']);
      const isWeight = (w) => Number.isInteger(w) && w > 0;
      expect(Object.keys(file.outputs)).toHaveLength(75);
      expect(Object.values(file.outputs).every(isWeight)).toBe(true);
      expect(file.outputs['obj/blink/0.o']).toBe(300);
      expect(file.outputs['obj/new.o']).toBe(450);
      expect(file.outputs).not.toHaveProperty('all');
      expect(isWeight(file.default)).toBe(true);
      for (const rule of file.rules) {
        expect(Object.keys(rule).sort()).toEqual(['action', 'weight']);
        expect(isWeight(rule.weight)).toBe(true);
      }
      // The incremental build had too few steps for new rules, so the clean
      // build's rules are kept.
      expect(file.rules).toEqual([
        { action: 'cxx', weight: 440 },
        { action: 'alink', weight: 52 },
      ]);
      for (const rule of file.rules) {
        expect(new RegExp(`^(?:${rule.action})$`).test(rule.action.replace(/\\/g, ''))).toBe(true);
      }
      expect(fs.existsSync(`${learned()}.tmp`)).toBe(false);
    });
  });
});
