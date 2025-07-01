import { execFileSync, ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { color, fatal } from './logging.js';
import { depotSpawnSync } from '../utils/depot-tools.js';
import * as evmConfig from '../evm-config.js';

const execFileSyncWithLog = (cmd: string, args: string[], opts: ExecFileSyncOptions): void => {
  console.log(color.childExec(cmd, args, opts));
  execFileSync(cmd, args, opts);
};

const isReclientConfigured = (): boolean => {
  const { root } = evmConfig.current();
  const srcDir = path.resolve(root, 'src');
  const engflowConfigsDir = path.resolve(srcDir, 'third_party', 'engflow-reclient-configs');
  return existsSync(engflowConfigsDir);
};

export function configureReclient(): void {
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
    depotSpawnSync(evmConfig.current(), 'git', ['checkout', ENGFLOW_CONFIG_SHA], {
      cwd: engflowConfigsDir,
      stdio: 'ignore',
    });

    const reclientConfigPatchPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'tools',
      'engflow_reclient_configs.patch',
    );
    depotSpawnSync(
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
    depotSpawnSync(
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
    depotSpawnSync(
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
