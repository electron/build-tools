const cp = require('child_process');

const { color } = require('./logging');
const { refreshPathVariable } = require('./refresh-path');
const { whichAndFix } = require('./which');

const spawnSyncWithLog = (cmd, args) => {
  console.log(color.childExec(cmd, args, {}));
  return cp.spawnSync(cmd, args);
};

const deps = {
  win32: [
    {
      cmd: 'python',
      fix: () => {
        spawnSyncWithLog('choco', ['install', 'python2']);
      },
      deps: ['choco'],
    },
    {
      cmd: 'choco',
      fix: () => {
        spawnSyncWithLog('powershell', [
          '-Command',
          "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))",
        ]);
      },
    },
  ],
};

const checkPlatformDependencies = () => {
  // Refresh the PATH variable at the top of this shell so that retries in the same shell get the latest PATH variable
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
      whichAndFix(dep.cmd, dep.fix);
      for (const oDep of depsToResolve) {
        if (oDep === dep) continue;
        if (oDep.deps) {
          oDep.deps = oDep.deps.filter(d => d !== dep.cmd);
        }
      }
    }
    depsToResolve = newDeps;

    if (previousLength === depsToResolve.length) {
      throw new Error(
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
