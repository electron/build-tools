#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const program = require('commander');
const https = require('https');

const evmConfig = require('./evm-config');
const { depot, sccache, fatal, getOrCreateUuid, readElectronVersion } = require('./util');

function runGNGen(config) {
  depot.ensure();

  const gn_args = config.gen.args.join(' ').replace(/\"/g, '\\"'); // gn parses this part -- inner quotes must be escaped
  const exec = `${path.resolve(depot.path, 'gn.py')} gen "out/${
    config.gen.out
  }" --args="${gn_args}"`;
  const opts = { cwd: path.resolve(config.root, 'src') };
  depot.execSync(config, exec, opts);
}

function ensureGNGen(config) {
  const buildfile = path.resolve(evmConfig.outDir(config), 'build.ninja');
  if (!fs.existsSync(buildfile)) runGNGen(config);
}

function runNinja(config, target, ninjaArgs) {
  sccache.ensure(config);
  depot.ensure(config);
  ensureGNGen(config);

  const exec = os.platform === 'win32' ? 'ninja.exe' : 'ninja';
  const args = [...ninjaArgs, target];
  const opts = { cwd: evmConfig.outDir(config) };

  const start = Date.now();
  depot.execFileSync(config, exec, args, opts);
  recordBuildTiming({
    elapsed_time_ms: Date.now() - start,
    build_target: target,
    electron_version: readElectronVersion(config),
  });
}

function recordBuildTiming({ elapsed_time_ms, build_target, electron_version }) {
  if (process.env.EVM_SKIP_TELEMETRY) return;
  // If it fails, nbd, we'll just miss this timing.
  const req = https.request({
    hostname: 'electron-build-perf-21c0b.firebaseio.com',
    path: '/build-timings.json',
    method: 'POST',
  });

  req.write(
    JSON.stringify({
      elapsed_time_ms,
      electron_version,
      build_target,
      uid: getOrCreateUuid(),
      ram: os.totalmem(),
      cores: os.cpus().length,
      timestamp: { '.sv': 'timestamp' },
    }),
  );
  req.end();
}

program
  .allowUnknownOption()
  .arguments('[target] [ninjaArgs...]')
  .description('Build Electron and other targets.')
  .option('--list-targets', 'Show all supported targets', false)
  .option('--gen', 'Force a re-run of `gn gen` before building', false)
  .parse(process.argv);

const pretty_targets = {
  breakpad: 'third_party/breakpad:dump_sym',
  chromedriver: 'electron:electron_chromedriver_zip',
  electron: 'electron',
  'electron:dist': 'electron:electron_dist_zip',
  mksnapshot: 'electron:electron_mksnapshot_zip',
  'node:headers': 'third_party/electron_node:headers',
};

if (program.listTargets) {
  Object.keys(pretty_targets)
    .sort()
    .forEach(target => console.log(target));
}

try {
  const config = evmConfig.current();
  if (program.gen) {
    runGNGen(config);
  }

  // collect all the unrecognized args that aren't a target
  const pretty = Object.keys(pretty_targets).find(p => program.rawArgs.includes(p)) || 'electron';
  const args = program.parseOptions(process.argv).unknown;
  const index = args.indexOf(pretty);
  if (index != -1) {
    args.splice(index, 1);
  }

  runNinja(config, pretty_targets[pretty], args);
} catch (e) {
  fatal(e);
}
