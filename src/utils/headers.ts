import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as evmConfig from '../evm-config';
import type { SanitizedConfig } from '../types';
import { ensureDir } from './paths';

export function ensureNodeHeaders(config: SanitizedConfig, useRemote: boolean): void {
  const src_dir = path.resolve(config.root, 'src');
  const out_dir = evmConfig.outDir(config);
  const node_headers_dir = path.resolve(out_dir, 'gen', 'node_headers');
  const electron_spec_dir = path.resolve(src_dir, 'electron', 'spec');

  let needs_build: boolean;
  try {
    const filename = path.resolve(electron_spec_dir, 'package.json');
    const package_time = fs.lstatSync(filename);
    const headers_time = fs.lstatSync(node_headers_dir);
    needs_build = package_time.mtimeMs > headers_time.mtimeMs;
  } catch {
    needs_build = true;
  }

  if (needs_build) {
    const exec = process.execPath;
    const args = [path.resolve(__dirname, '..', 'e'), 'build', 'electron:node_headers'];
    if (!useRemote) args.push('--no-remote');

    childProcess.execFileSync(exec, args, { stdio: 'inherit', encoding: 'utf8' });
  }

  if (process.platform === 'win32') {
    ensureDir(path.resolve(node_headers_dir, 'Release'));
    fs.copyFileSync(
      path.resolve(out_dir, 'electron.lib'),
      path.resolve(node_headers_dir, 'Release', 'node.lib'),
    );
  }
}
