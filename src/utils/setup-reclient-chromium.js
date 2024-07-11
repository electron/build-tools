const { spawnSync, execFileSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const process = require('process');

const { color, fatal } = require('./logging');
const evmConfig = require('../evm-config');

const execFileSyncWithLog = (cmd, args, opts) => {
  console.log(color.childExec(cmd, args, opts));
  return execFileSync(cmd, args, opts);
};

const spawnSyncWithLog = (cmd, args, opts) => {
  console.log(color.childExec(cmd, args, opts));
  return spawnSync(cmd, args, opts);
};

const isReclientConfigured = () => {
  const { root } = evmConfig.current();
  const srcDir = path.resolve(root, 'src');
  const engflowConfigsDir = path.resolve(srcDir, 'third_party', 'engflow-reclient-configs');
  return existsSync(engflowConfigsDir);
};

function configureReclient() {
  const { root, defaultTarget } = evmConfig.current();

  if (isReclientConfigured() || defaultTarget !== 'chrome') {
    return;
  }

  console.info(`${color.info} Configuring reclient for use with Chromium`);

  const srcDir = path.resolve(root, 'src');
  const engflowConfigsDir = path.resolve(srcDir, 'third_party', 'engflow-reclient-configs');
  if (!existsSync(engflowConfigsDir)) {
    execFileSyncWithLog(
      'git',
      ['clone', 'https://github.com/EngFlow/reclient-configs', engflowConfigsDir],
      {
        cwd: srcDir,
        stdio: 'inherit',
      },
    );

    if (!existsSync(engflowConfigsDir)) {
      fatal('Failed to clone EngFlow reclient configs');
    }

    const ENGFLOW_CONFIG_SHA =
      process.env.ENGFLOW_CONFIG_SHA || '955335c30a752e9ef7bff375baab5e0819b6c00d';
    spawnSyncWithLog('git', ['checkout', ENGFLOW_CONFIG_SHA], {
      cwd: engflowConfigsDir,
      stdio: 'ignore',
    });

    const reclientConfigPatchPath = path.resolve(
      __dirname,
      '..',
      '..',
      'tools',
      'engflow_reclient_configs.patch',
    );
    const { status: patchStatus } = spawnSyncWithLog('git', ['apply', reclientConfigPatchPath], {
      cwd: engflowConfigsDir,
      stdio: 'inherit',
    });

    if (patchStatus !== 0) {
      fatal('Failed to apply EngFlow reclient configs patch');
    }

    const configureConfigScript = path.join(engflowConfigsDir, 'configure_reclient.py');
    const { status: configureStatus } = spawnSyncWithLog(
      'python3',
      [configureConfigScript, '--src_dir=src', '--force'],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );

    if (configureStatus !== 0) {
      fatal('Failed to configure EngFlow reclient configs');
    }

    console.info(`${color.info} Successfully configured EngFlow reclient configs for Chromium`);
  }
}

module.exports = {
  configureReclient,
};
