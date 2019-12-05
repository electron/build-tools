const chalk = require('chalk');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pathKey = require('path-key');

const defaultDepotPath = path.resolve(__dirname, '..', 'third_party', 'depot_tools');
const macOSSDKsPath = path.resolve(__dirname, '..', 'third_party', 'macOS_SDKs');
const DEPOT_TOOLS_DIR = process.env.DEPOT_TOOLS_DIR || defaultDepotPath;

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  if (p.startsWith('~/')) return path.resolve(os.homedir(), p.substr(2));
  return path.resolve(process.cwd(), p);
}

function ensureDir(dir) {
  dir = resolvePath(dir);
  if (!fs.existsSync(dir)) {
    console.log(`Creating ${color.path(dir)}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

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

  // if it doesn't exist, create it
  if (!fs.existsSync(depot_dir)) {
    console.log(`Cloning ${color.cmd('depot_tools')} into ${color.path(depot_dir)}`);
    const url = 'https://chromium.googlesource.com/chromium/tools/depot_tools.git';
    childProcess.execFileSync('git', ['clone', '-q', url, depot_dir], { stdio: 'inherit' });
    updateDepotTools();
  }

  // if it's been awhile, update it
  const now = new Date();
  const msec_per_day = 86400000;
  const days_before_pull = 14;
  const days_untouched = (now.getTime() - fs.statSync(depot_dir).mtimeMs) / msec_per_day;
  if (days_untouched >= days_before_pull) {
    updateDepotTools();
    fs.utimesSync(depot_dir, now, now);
  }
}

function ensureMacOSSDKs() {
  if (!fs.existsSync(macOSSDKsPath)) {
    console.log(`Cloning ${color.cmd('MacOSX-SDKs')} into ${color.path(macOSSDKsPath)}`);
    const url = 'https://github.com/phracker/MacOSX-SDKs.git';
    childProcess.execFileSync('git', ['clone', '-q', url, macOSSDKsPath], { stdio: 'inherit' });
  } else {
    childProcess.execFileSync('git', ['pull', '-q'], { cwd: macOSSDKsPath, stdio: 'inherit' });
  }
}

function depotOpts(config, opts = {}) {
  // some defaults
  opts = {
    encoding: 'utf8',
    stdio: 'inherit',
    ...opts,
  };

  opts.env = {
    // set these defaults that can be overridden via process.env
    PYTHONDONTWRITEBYTECODE: '1', // depot needs it
    DEPOT_TOOLS_METRICS: '0', // disable depot metrics

    ...process.env,
    ...config.env,
    ...opts.env,
  };

  // put depot tools at the front of the path
  const key = pathKey();
  opts.env[key] = [DEPOT_TOOLS_DIR, process.env[key]].join(path.delimiter);

  return opts;
}

function depotExecSync(config, cmd, opts_in) {
  const opts = depotOpts(config, opts_in);
  console.log(color.childExec(cmd, null, opts));
  childProcess.execSync(cmd, opts);
}

function depotExecFileSync(config, exec, args, opts_in) {
  if (exec === 'python' && !path.isAbsolute(args[0])) {
    args[0] = path.resolve(DEPOT_TOOLS_DIR, args[0]);
  }
  const opts = depotOpts(config, opts_in);
  console.log(color.childExec(exec, args, opts));
  childProcess.execFileSync(exec, args, opts);
}

function getSCCacheExec(root) {
  return path.resolve(root, 'src', 'electron', 'external_binaries', 'sccache');
}

function ensureSCCache(config) {
  const sccache = getSCCacheExec(config.root);
  const opts = { env: config.env, stdio: 'ignore' };

  if (os.platform() === 'win32') {
    console.debug(`Building on Windows -- skipping ${color.path(sccache)}`);
    return;
  }

  try {
    childProcess.execFileSync(sccache, ['--stop-server'], opts);
  } catch {
    // it's OK for this to fail -- maybe it wasn't running
  }

  for (;;) {
    try {
      const args = ['--start-server'];
      console.log(color.childExec(sccache, args, opts));
      childProcess.execFileSync(sccache, args, opts);
      break;
    } catch {
      console.warn('Failed to start sccache. Trying again...');
    }
  }
}

const color = {
  cmd: str => `"${chalk.cyan(str)}"`,
  config: str => `${chalk.blueBright(str)}`,
  git: str => `${chalk.greenBright(str)}`,
  path: str => `${chalk.yellow(str)}`,
  childExec: (cmd, args, opts) => {
    args = args || [];
    const cmdstr = [cmd, ...args].join(' ');
    const parts = ['Running', color.cmd(cmdstr)];
    if (opts && opts.cwd) {
      parts.push('in', color.path(opts.cwd));
    }
    return parts.join(' ');
  },
  done: chalk.bgGreenBright.black('DONE! 🎉'),
  err: chalk.bgRedBright.white('ERROR'),
  info: chalk.bgYellowBright.black('INFO'),
  warn: chalk.bgYellowBright.black('WARN'),
};

function fatal(e) {
  console.error(`${color.err} ${e.stack ? e.stack : e.message}`);
  process.exit(1);
}

// public

module.exports = {
  color,
  depot: {
    path: DEPOT_TOOLS_DIR,
    ensure: ensureDepotTools,
    execFileSync: depotExecFileSync,
    execSync: depotExecSync,
  },
  macOSSDKs: {
    path: macOSSDKsPath,
    ensure: ensureMacOSSDKs,
  },
  ensureDir,
  fatal,
  resolvePath,
  sccache: {
    ensure: ensureSCCache,
    exec: root => getSCCacheExec(root),
  },
};
