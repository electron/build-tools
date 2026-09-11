import * as fs from 'node:fs';
import * as path from 'node:path';

import * as depot from './depot-tools.js';
import type { SanitizedConfig } from '../types.js';

type ConfigLike = Pick<SanitizedConfig, 'remoteBuild' | 'root' | 'env'>;

const wrapperSource = path.resolve(import.meta.dirname, '../../tools/clang_remote_wrapper');

// On these hosts Chromium's GN (build/toolchain/rbe.gni) and siso config
// (build/config/siso/clang_{mac,windows}.star) refuse a remote build without a
// rewrapper cfg at this path, so the wrapper lives here next to a stub cfg that
// names it; tools/main.star attaches the wrapper to the clang rules itself.
const crossClangDir = 'buildtools/reclient_cfgs/chromium-browser-clang';
const wrapperPath = `${crossClangDir}/clang_remote_wrapper`;
const rewrapperCfg = `platform=OSFamily=Linux
remote_wrapper=../../${wrapperPath}
`;

function readStamp(clangDir: string): string | null {
  try {
    return fs.readFileSync(path.join(clangDir, 'cr_build_revision'), 'utf8');
  } catch {
    return null;
  }
}

function installFile(file: string, contents: string | Buffer, mode = 0o644): void {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(contents))) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
}

/**
 * Electron's RBE workers are Linux, so remote clang steps from a macOS or
 * Windows host run Chromium's Linux clang through tools/clang_remote_wrapper.
 * Stage that toolchain at third_party/llvm-build/Release+Asserts_linux, at the
 * same revision as the host one, and install the wrapper where main.star and
 * Chromium's siso config look for it.
 */
export function ensureCrossClang(config: ConfigLike): void {
  if (config.remoteBuild !== 'siso') return;
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;

  const src = path.resolve(config.root, 'src');
  const hostClang = path.resolve(src, 'third_party/llvm-build/Release+Asserts');
  const linuxClang = `${hostClang}_linux`;

  const hostStamp = readStamp(hostClang);
  if (hostStamp === null || hostStamp !== readStamp(linuxClang)) {
    depot.spawnSync(
      config,
      'python3',
      [
        path.resolve(src, 'tools/clang/scripts/update.py'),
        '--output-dir',
        linuxClang,
        '--host-os',
        'linux',
      ],
      { cwd: src },
      'Failed to download the Linux clang toolchain used for remote compiles',
    );
  }

  installFile(path.resolve(src, wrapperPath), fs.readFileSync(wrapperSource), 0o755);
  const host = process.platform === 'darwin' ? 'mac' : 'windows';
  installFile(path.resolve(src, crossClangDir, `rewrapper_${host}.cfg`), rewrapperCfg);
}
