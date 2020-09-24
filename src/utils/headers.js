const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const evmConfig = require('../evm-config');
const { ensureDir } = require('./paths');

function ensureNodeHeaders(config) {
  const src_dir = path.resolve(config.root, 'src');
  const out_dir = evmConfig.outDir(config);
  const node_headers_dir = path.resolve(out_dir, 'gen', 'node_headers');
  const electron_spec_dir = path.resolve(src_dir, 'electron', 'spec');

  let needs_build;
  try {
    const filename = path.resolve(electron_spec_dir, 'package.json');
    const package_time = fs.lstatSync(filename);
    const headers_time = fs.lstatSync(node_headers_dir);
    needs_build = package_time > headers_time;
  } catch {
    needs_build = true;
  }

  if (needs_build) {
    const exec = process.execPath;
    const args = [path.resolve(__dirname, '..', 'e'), 'build', 'node:headers'];
    const opts = { stdio: 'inherit', encoding: 'utf8' };
    childProcess.execFileSync(exec, args, opts);
  }

  if (process.platform === 'win32') {
    ensureDir(path.resolve(node_headers_dir, 'Release'));
    fs.copyFileSync(
      path.resolve(out_dir, 'electron.lib'),
      path.resolve(node_headers_dir, 'Release', 'node.lib'),
    );
  }
}

module.exports = {
  ensureNodeHeaders,
};
