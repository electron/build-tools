import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureCrossClang } from '../dist/utils/cross-clang.js';

const crossHost = process.platform === 'darwin' || process.platform === 'win32';
const cfgDir = 'src/buildtools/reclient_cfgs/chromium-browser-clang';

describe('ensureCrossClang', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-clang-'));
    for (const dir of ['Release+Asserts', 'Release+Asserts_linux']) {
      const clangDir = path.join(root, 'src/third_party/llvm-build', dir);
      fs.mkdirSync(clangDir, { recursive: true });
      fs.writeFileSync(path.join(clangDir, 'cr_build_revision'), 'llvmorg-99-init-1-gabcdef-1');
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!crossHost)('installs the wrapper and a rewrapper cfg that names it', () => {
    ensureCrossClang({ remoteBuild: 'siso', root, env: {} });

    const wrapper = fs.readFileSync(path.join(root, cfgDir, 'clang_remote_wrapper'), 'utf8');
    expect(wrapper).toEqual(
      fs.readFileSync(path.join(import.meta.dirname, '../tools/clang_remote_wrapper'), 'utf8'),
    );
    expect(wrapper).not.toContain('\r');

    const cfgName = process.platform === 'darwin' ? 'rewrapper_mac.cfg' : 'rewrapper_windows.cfg';
    const cfg = fs.readFileSync(path.join(root, cfgDir, cfgName), 'utf8').split('\n');
    expect(cfg).toContain('platform=OSFamily=Linux');
    expect(cfg).toContain(
      'remote_wrapper=../../buildtools/reclient_cfgs/chromium-browser-clang/clang_remote_wrapper',
    );
  });

  it.skipIf(!crossHost)('does nothing for builds that are not remote', () => {
    ensureCrossClang({ remoteBuild: 'none', root, env: {} });

    expect(fs.existsSync(path.join(root, cfgDir))).toBe(false);
  });

  it.skipIf(crossHost)('does nothing on a Linux host', () => {
    ensureCrossClang({ remoteBuild: 'siso', root, env: {} });

    expect(fs.existsSync(path.join(root, cfgDir))).toBe(false);
  });
});
