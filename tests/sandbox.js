const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deleteDir } = require('../dist/utils/paths');
const { pathKey } = require('../dist/utils/path-key');

const PATH_KEY = pathKey();

// execFileSync() wrapper that runs one of the compiled `e-*.js` CLIs.
// Coverage of these child processes is collected natively by V8: the test
// script wraps vitest in c8, which sets NODE_V8_COVERAGE, and the sandbox
// env passes that variable through to each spawned process (see below).
// Returns { exitCode:number, stderr:string, stdout:string }
function runSync(args, options) {
  const debug = false;

  const ret = {
    stdout: '',
    stderr: '',
    exitCode: 0,
  };

  try {
    if (debug) console.log(args);
    const out = childProcess.execFileSync(process.execPath, args, options);
    if (out) {
      ret.stdout = out.toString().trim();
    }
  } catch (e) {
    if (debug) console.log(e);
    ret.exitCode = e.status;
    if (e.stdout) ret.stdout = e.stdout.toString().trim();
    if (e.stderr) ret.stderr = e.stderr.toString().trim();
  } finally {
    if (debug) console.log(ret);
  }

  return ret;
}

const buildToolsDistDir = path.resolve(__dirname, '..', 'dist');

// An `e init` helper.
// Example use: result = eInitRunner().root('~/electron-src')
//   .name('main-testing').import('testing').run();
// Returns { exitCode:number, stderr:string, stdout:string }
function eInitRunner(execOptions) {
  const stdio = 'pipe';
  const cmd = path.resolve(buildToolsDistDir, 'e-init.js');
  const args = [];

  const o = {
    asan: () => {
      args.push('--asan');
      return o;
    },
    force: () => {
      args.push('--force');
      return o;
    },
    fork: (name) => {
      args.push(`--fork=${name}`);
      return o;
    },
    useHttps: () => {
      args.push(`--use-https`);
      return o;
    },
    import: (val) => {
      args.push('--import', val);
      return o;
    },
    name: (name) => {
      args.push(name);
      return o;
    },
    out: (val) => {
      args.push('--out', val);
      return o;
    },
    root: (val) => {
      args.push('--root', val);
      return o;
    },
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
  };

  return o;
}

// An `e build` helper.
// Example use: result = eMakeRunner().run();
// Returns { exitCode:number, stderr:string, stdout:string }
function eMakeRunner(execOptions) {
  let stdio = 'inherit'; // runs a really long time, so dump output to parent
  const cmd = path.resolve(buildToolsDistDir, 'e-build.js');
  const args = [];

  const o = {
    gen: () => {
      args.push('--gen');
      return o;
    },
    list_targets: () => {
      args.push('--list-targets');
      stdio = 'pipe';
      return o;
    },
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
  };

  return o;
}

// An `e show` helper.
// Example use: result = eShowRunner().src('base').run();
// Returns { exitCode:number, stderr:string, stdout:string }
function eShowRunner(execOptions) {
  const stdio = 'pipe';
  const cmd = path.resolve(buildToolsDistDir, 'e-show.js');
  const args = [];

  const o = {
    configs: () => {
      args.push('configs');
      return o;
    },
    current: () => {
      args.push('current');
      return o;
    },
    env: () => {
      args.push('env');
      return o;
    },
    exec: () => {
      args.push('exec');
      return o;
    },
    filename: () => {
      args.push('current', '--filepath', '--no-name');
      return o;
    },
    git: () => {
      args.push('current', '--git');
      return o;
    },
    out: () => {
      args.push('out');
      return o;
    },
    root: () => {
      args.push('root');
      return o;
    },
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
    src: (name) => {
      args.push('src');
      if (name) args.push(name);
      return o;
    },
    stats: () => {
      args.push('stats');
      return o;
    },
  };

  return o;
}

// An `e sync` helper.
// Example use: result = eSyncRunner().run(); // not many options in this one!
// Returns { exitCode:number, stderr:string, stdout:string }
function eSyncRunner(execOptions) {
  let stdio = 'inherit'; // runs a really long time, so dump output to parent
  const cmd = path.resolve(buildToolsDistDir, 'e-sync.js');
  const args = [];

  const o = {
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
  };

  return o;
}

// A generic `e` helper that invokes the top-level dispatcher with raw args.
// Example use: result = eRunner().args('--config=foo', 'show', 'current').run();
// Returns { exitCode:number, stderr:string, stdout:string }
function eRunner(execOptions) {
  const stdio = 'pipe';
  const cmd = path.resolve(buildToolsDistDir, 'e.js');
  let args = [];

  const o = {
    args: (...a) => {
      args = a;
      return o;
    },
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
  };

  return o;
}

// An `e remove` helper.
// Example use: result = eRemoveRunner().name('test').run();
// Returns { exitCode:number, stderr:string, stdout:string }
function eRemoveRunner(execOptions) {
  const stdio = 'pipe';
  const cmd = path.resolve(buildToolsDistDir, 'e.js');
  const args = ['remove'];

  const o = {
    name: (name) => {
      args.push(name);
      return o;
    },
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
  };

  return o;
}

function createSandbox({ stubDepotTools = false } = {}) {
  // create new temporary directories
  const tmpdir = fs.mkdtempSync(path.join(process.cwd(), 'build-tools-spec-'));
  const evm_config_dir = path.resolve(tmpdir, 'evm-config');
  fs.mkdirSync(evm_config_dir);

  // the execSync options object
  const execOptions = {
    encoding: 'utf8',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      // have `e` use our test sandbox's build-tools config dir
      EVM_CONFIG: evm_config_dir,
      // we want to detect vitest
      __VITEST__: 1,
      [PATH_KEY]: process.env[PATH_KEY],
    },
  };

  // Tests that aren't about the depot_tools bootstrap itself can point the
  // CLI at a fixture containing a stub `gclient`, sparing them the cost of
  // cloning/updating the real depot_tools and bootstrapping vpython.
  if (stubDepotTools) {
    execOptions.env.DEPOT_TOOLS_DIR = path.resolve(__dirname, 'fixtures', 'depot_tools');
  }

  // let V8 write coverage for spawned CLI processes when the test run is
  // wrapped in c8 (which sets NODE_V8_COVERAGE)
  if (process.env.NODE_V8_COVERAGE) {
    execOptions.env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE;
  }

  // vpython pulls user home directory from environment variables
  if (os.platform() === 'win32') {
    execOptions.env.LocalAppData = process.env.LocalAppData;
  } else {
    execOptions.env.HOME = process.env.HOME;
  }

  // allow CI to pin vpython's virtualenv cache to a cacheable location
  if (process.env.VPYTHON_VIRTUALENV_ROOT) {
    execOptions.env.VPYTHON_VIRTUALENV_ROOT = process.env.VPYTHON_VIRTUALENV_ROOT;
  }

  return {
    cleanup: () => deleteDir(tmpdir),
    eInitRunner: () => {
      return eInitRunner(execOptions);
    },
    eMakeRunner: () => {
      return eMakeRunner(execOptions);
    },
    eShowRunner: () => {
      return eShowRunner(execOptions);
    },
    eSyncRunner: () => {
      return eSyncRunner(execOptions);
    },
    eRemoveRunner: () => {
      return eRemoveRunner(execOptions);
    },
    eRunner: () => {
      return eRunner(execOptions);
    },
    randomString: () => Math.random().toString(36).substring(2, 15),
    tmpdir,
  };
}

module.exports = createSandbox;
