const cp = require('child_process');

const { color, fatal } = require('./logging');
const { refreshPathVariable } = require('./refresh-path');
const { whichAndFix } = require('./which');

const spawnSyncWithLog = (cmd, args) => {
  console.log(color.childExec(cmd, args, {}));
  const result = cp.spawnSync(cmd, args);
  if (result.status !== 0) {
    throw new Error(`Failed to run "${cmd} ${args.join(' ')}"`);
  }
};

const deps = {
  win32: [
    {
      cmd: 'choco',
      fix: () => {
        spawnSyncWithLog('powershell', [
          '-Command',
          "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))",
        ]);
      },
    },
    {
      cmd: 'python',
      fix: () => {
        spawnSyncWithLog('choco', ['install', 'python2', '--yes']);
      },
      deps: ['choco'],
    },
    {
      cmd: 'pywin32',
      check: () => {
        return cp.spawnSync('python', ['-c', 'import win32process']).status === 0;
      },
      fix: () => {
        spawnSyncWithLog('choco', ['install', 'pywin32', '--yes']);
      },
      deps: ['choco'],
    },
  ],
};

const checkPlatformDependencies = () => {
  // Use latest PATH variable when searching for deps
  refreshPathVariable();

  if (!deps[process.platform]) return;
  let depsToResolve = deps[process.platform];
  let previousLength = depsToResolve.length;
  while (depsToResolve.length > 0) {
    const newDeps = [];
    for (const dep of depsToResolve) {
      // Still waiting for stuff
      if (dep.deps && dep.deps.length > 0) {
        newDeps.push(dep);
        continue;
      }
      whichAndFix(dep.cmd, dep.check, dep.fix);
      for (const oDep of depsToResolve) {
        if (oDep === dep) continue;
        if (oDep.deps) {
          oDep.deps = oDep.deps.filter(d => d !== dep.cmd);
        }
      }
    }
    depsToResolve = newDeps;

    if (previousLength === depsToResolve.length) {
      fatal(
        'Unable to resolve dependencies, this is impossible so please raise an issue on the build-tools repository',
      );
    }
  }
};

module.exports = {
  checkPlatformDependencies,
};

if (process.mainModule === module) {
  checkPlatformDependencies();
}
