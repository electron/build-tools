const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const pathKey = require('path-key');

const { color } = require('./logging');

const defaultDepotPath = path.resolve(__dirname, '..', '..', 'third_party', 'depot_tools');
const DEPOT_TOOLS_DIR = process.env.DEPOT_TOOLS_DIR || defaultDepotPath;

const markerFilePath = path.join(DEPOT_TOOLS_DIR, '.disable_auto_update');

function updateDepotTools() {
  const depot_dir = DEPOT_TOOLS_DIR;
  console.log(`Updating ${color.path(depot_dir)}`);
  if (os.platform() === 'win32') {
    depotExecFileSync({}, 'cmd.exe', ['/c', path.resolve(depot_dir, 'update_depot_tools.bat')]);
  } else {
    depotExecFileSync({}, path.resolve(depot_dir, 'update_depot_tools'));
  }
}

function ensureDepotTools() {
  const depot_dir = DEPOT_TOOLS_DIR;

  // If it doesn't exist, create it.
  if (!fs.existsSync(depot_dir)) {
    console.log(`Cloning ${color.cmd('depot_tools')} into ${color.path(depot_dir)}`);
    const url = 'https://chromium.googlesource.com/chromium/tools/depot_tools.git';
    childProcess.execFileSync('git', ['clone', '-q', url, depot_dir], { stdio: 'inherit' });
    updateDepotTools();
  }

  if (fs.existsSync(markerFilePath)) {
    // NB: send updater's stdout to stderr so its log messages are visible
    // but don't pollute stdout. For example, calling `FOO="$(e show exec)"`
    // should not get a FOO that includes "Checking for build-tools updates".
    console.error(
      `${color.info} Automatic depot_tools updates disabled, skipping check for updates`,
    );
    return;
  }

  // If it's been awhile, update it.
  const now = new Date();
  const msec_per_day = 86400000;
  const days_before_pull = 14;
  const days_untouched = (now.getTime() - fs.statSync(depot_dir).mtimeMs) / msec_per_day;
  if (days_untouched >= days_before_pull) {
    updateDepotTools();
    fs.utimesSync(depot_dir, now, now);
  }
}

function platformOpts() {
  let opts = {};

  const winToolchainOverride = process.env.ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN;
  if (os.platform() === 'win32' || winToolchainOverride === '1') {
    opts = {
      DEPOT_TOOLS_WIN_TOOLCHAIN: '1',
      DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL: 'https://dev-cdn.electronjs.org/windows-toolchains/_',
      GYP_MSVS_HASH_9ff60e43ba91947baca460d0ca3b1b980c3a2c23:
        '6d205e765a23d3cbe0fcc8d1191ae406d8bf9c04',
      GYP_MSVS_HASH_a687d8e2e4114d9015eb550e1b156af21381faac:
        'b1bdbc45421e4e0ff0584c4dbe583e93b046a411',
      GYP_MSVS_HASH_20d5f2553f: 'e146e01913',
      GYP_MSVS_HASH_3bda71a11e: 'e146e01913',
      GYP_MSVS_HASH_e41785f09f: 'e146e01913',
      GYP_MSVS_HASH_1023ce2e82: '3a908a0f94',
      GYP_MSVS_HASH_27370823e7: '28622d16b1',
      GYP_MSVS_HASH_7393122652: '3ba76c5c20',
      GYP_MSVS_HASH_698eb5635a: 'e2bf90edff',
    };
  }

  return opts;
}

function depotOpts(config, opts = {}) {
  // some defaults
  opts = {
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  };

  opts.env = {
    // set these defaults that can be overridden via process.env
    PYTHONDONTWRITEBYTECODE: '1', // depot needs it
    DEPOT_TOOLS_METRICS: '0', // disable depot metrics
    // Circular reference so we have to delay load
    ...process.env,
    ...platformOpts(),
    ...config.env,
    ...opts.env,
    // Circular reference so we have to delay load
    ...require('./reclient').env(config),
  };

  // put depot tools at the front of the path
  const key = pathKey();
  const paths = [DEPOT_TOOLS_DIR];

  // On apple silicon the default python2 binary does not work
  // with vpython.  The one depot tools vends _does_ work.  So we
  // add that one to the path ahead of your default python
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const pythonRelDirFile = path.resolve(DEPOT_TOOLS_DIR, 'python_bin_reldir.txt');
    if (fs.existsSync(pythonRelDirFile)) {
      paths.push(path.resolve(DEPOT_TOOLS_DIR, fs.readFileSync(pythonRelDirFile, 'utf8').trim()));
    }
  }
  // Remove any duplicates on path so that DEPOT_TOOLS_DIR isn't added if it is already there
  const currentPath = process.env[key].split(path.delimiter);
  opts.env[key] = Array.from(new Set([...paths, ...currentPath])).join(path.delimiter);

  return opts;
}

function depotSpawnSync(config, cmd, args, opts_in) {
  const opts = depotOpts(config, opts_in);
  if (os.platform() === 'win32' && ['python', 'python3'].includes(cmd)) {
    cmd = `${cmd}.bat`;
  }
  if (!process.env.ELECTRON_DEPOT_TOOLS_DISABLE_LOG) {
    if (opts_in.msg) {
      console.log(opts_in.msg);
    } else {
      console.log(color.childExec(cmd, args, opts));
    }
  }
  return childProcess.spawnSync(cmd, args, opts);
}

function depotExecFileSync(config, exec, args, opts_in) {
  const opts = depotOpts(config, opts_in);
  if (['python', 'python3'].includes(exec) && !opts.cwd && !path.isAbsolute(args[0])) {
    args[0] = path.resolve(DEPOT_TOOLS_DIR, args[0]);
  }
  if (os.platform() === 'win32' && ['python', 'python3'].includes(exec)) {
    exec = `${exec}.bat`;
  }
  console.log(color.childExec(exec, args, opts));
  return childProcess.execFileSync(exec, args, opts);
}

function setAutoUpdate(enable) {
  try {
    if (enable) {
      if (fs.existsSync(markerFilePath)) {
        fs.unlinkSync(markerFilePath);
      }
      console.info(`${color.info} Automatic depot_tools updates enabled`);
    } else {
      fs.closeSync(fs.openSync(markerFilePath, 'w'));
      console.info(`${color.info} Automatic depot_tools updates disabled`);
    }
  } catch (e) {
    fatal(e);
  }
}

module.exports = {
  opts: depotOpts,
  path: DEPOT_TOOLS_DIR,
  ensure: ensureDepotTools,
  execFileSync: depotExecFileSync,
  spawnSync: depotSpawnSync,
  setAutoUpdate,
};
