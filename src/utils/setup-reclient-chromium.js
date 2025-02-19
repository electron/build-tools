const { execFileSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const process = require('process');

const { color, fatal } = require('./logging');
const { spawnSync } = require('../utils/depot-tools');
const evmConfig = require('../evm-config');

const execFileSyncWithLog = (cmd, args, opts) => {
  console.log(color.childExec(cmd, args, opts));
  return execFileSync(cmd, args, opts);
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

    // Pinning to prevent unexpected breakage.
    const ENGFLOW_CONFIG_SHA =
      process.env.ENGFLOW_CONFIG_SHA || '7851c9387a770d6381f4634cb293293d2b30c502';
    spawnSync(evmConfig.current(), 'git', ['checkout', ENGFLOW_CONFIG_SHA], {
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
    spawnSync(
      evmConfig.current(),
      'git',
      ['apply', reclientConfigPatchPath],
      {
        cwd: engflowConfigsDir,
        stdio: 'inherit',
      },
      'Failed to apply EngFlow reclient configs patch',
    );

    const configureReclientScript = path.join(engflowConfigsDir, 'configure_reclient.py');
    spawnSync(
      evmConfig.current(),
      'python3',
      [configureReclientScript, '--src_dir=src', '--force'],
      {
        cwd: root,
        stdio: 'inherit',
      },
      'Failed to configure EngFlow reclient configs',
    );

    const configureConfigScript = path.join(
      srcDir,
      'buildtools',
      'reclient_cfgs',
      'configure_reclient_cfgs.py',
    );
    spawnSync(
      evmConfig.current(),
      'python3',
      [
        configureConfigScript,
        '--rbe_instance',
        'projects/rbe-chrome-untrusted/instances/default_instance',
        '--reproxy_cfg_template',
        'reproxy.cfg.template',
        '--rewrapper_cfg_project',
        '',
        '--skip_remoteexec_cfg_fetch',
      ],
      {
        cwd: root,
        stdio: 'inherit',
      },
      'Failed to configure RBE config scripts for untrusted RBE',
    );

    console.info(`${color.info} Successfully configured EngFlow reclient configs for Chromium`);
  }
}

module.exports = {
  configureReclient,
};
