import * as cp from 'node:child_process';

import { Command } from 'commander';

import { which } from './which.js';

/**
 * git-style external subcommands: when `e foo` doesn't match a built-in
 * command, run an `e-foo` executable from PATH, forwarding the remaining
 * arguments and the child's exit status. Returns without exiting when no
 * external command applies so commander's usual handling (including
 * unknown-command errors) is unchanged.
 */
export function maybeRunExternalCommand(program: Command, argv: string[]): void {
  const name = argv[2];
  if (!name || name.startsWith('-')) return;

  // Built-in commands and their aliases always shadow PATH executables.
  const knownNames = new Set(program.commands.flatMap((cmd) => [cmd.name(), ...cmd.aliases()]));
  knownNames.add('help');
  if (knownNames.has(name)) return;

  const exec = which(`e-${name}`);
  if (!exec) return;

  // Node >= 20.12 refuses to spawn .cmd/.bat scripts unless a shell is used
  // (CVE-2024-27980 hardening), so quote the path and go through the shell.
  const useShell = /\.(cmd|bat)$/i.test(exec);
  const result = cp.spawnSync(useShell ? `"${exec}"` : exec, argv.slice(3), {
    stdio: 'inherit',
    shell: useShell,
  });
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
}
