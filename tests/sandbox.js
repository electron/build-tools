const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// for `rm -rf`'ing the sandbox tmpdir
const rimraf = require('rimraf');

// Get the PATH environment variable key cross-platform
// It's usually PATH, but on Windows it can be any casing like Path...
// https://github.com/sindresorhus/path-key
const pathKey = require('path-key')();

// execFileSync() wrapper that adds exec'ed scripts to code coverage.
// Returns { exitCode:number, stderr:string, stdout:string }
function runSync(args, options) {
  // jest doesn't directly support coverage of exec'ed scripts,
  // but this workaround of invoking nyc in spawn gets the job done.
  // https://github.com/facebook/jest/issues/3190#issuecomment-354758036
  const spawnCmd = os.platform() === 'win32' ? 'nyc.cmd' : 'nyc';
  const spawnArgs = ['--reporter', 'none', 'node'];
  const debug = false;

  args = [...spawnArgs, ...args];

  const ret = {
    stdout: '',
    stderr: '',
    exitCode: 0,
  };

  try {
    if (debug) console.log(args);
    const out = childProcess.execFileSync(spawnCmd, args, options);
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

const buildToolsSrcDir = path.resolve(__dirname, '..', 'src');

// An `e init` helper.
// Example use: result = eInitRunner().root('~/electron-src')
//   .name('main-testing').import('testing').run();
// Returns { exitCode:number, stderr:string, stdout:string }
function eInitRunner(execOptions) {
  const stdio = 'pipe';
  const cmd = path.resolve(buildToolsSrcDir, 'e-init.js');
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
    fork: name => {
      args.push(`--fork=${name}`);
      return o;
    },
    useHttps: () => {
      args.push(`--use-https`);
      return o;
    },
    import: val => {
      args.push('--import', val);
      return o;
    },
    name: name => {
      args.push(name);
      return o;
    },
    out: val => {
      args.push('--out', val);
      return o;
    },
    root: val => {
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
  const cmd = path.resolve(buildToolsSrcDir, 'e-build.js');
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
  const cmd = path.resolve(buildToolsSrcDir, 'e-show.js');
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
      args.push('current', '--filename', '--no-name');
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
    src: name => {
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
  const cmd = path.resolve(buildToolsSrcDir, 'e-sync.js');
  const args = [];

  const o = {
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
  const cmd = path.resolve(buildToolsSrcDir, 'e');
  const args = ['remove'];

  const o = {
    name: name => {
      args.push(name);
      return o;
    },
    run: () => {
      return runSync([cmd, ...args], { ...execOptions, stdio });
    },
  };

  return o;
}

function createSandbox() {
  // create new temporary directories
  const tmpdir = fs.mkdtempSync(path.join(process.cwd(), 'build-tools-spec-'));
  const evm_config_dir = path.resolve(tmpdir, 'evm-config');
  fs.mkdirSync(evm_config_dir);

  // the execSync options object
  const execOptions = {
    encoding: 'utf8',
    env: {
      // have `e` use our test sandbox's build-tools config dir
      EVM_CONFIG: evm_config_dir,

      [pathKey]: process.env[pathKey],
    },
  };

  return {
    cleanup: () => rimraf.sync(tmpdir),
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
    randomString: () =>
      Math.random()
        .toString(36)
        .substring(2, 15),
    tmpdir,
  };
}

module.exports = createSandbox;
