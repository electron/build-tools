#!/usr/bin/env node

const childProcess = require('child_process');
const open = require('open');
const os = require('os');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');

function gitStatus(config) {
  const exec = 'git';
  const opts = {
    cwd: path.resolve(config.root, 'src', 'electron'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  const switches = [
    ['describe', '--tags', '--exact-match'], // tag
    ['symbolic-ref', '-q', '--short', 'HEAD'], // branch
    ['rev-parse', '--short', 'HEAD'], // commit
  ];
  const outs = [];
  for (const args of switches) {
    try {
      outs.push(childProcess.execFileSync(exec, args, opts));
    } catch {}
  }
  return outs
    .map((out) => out.trim())
    .filter((out) => out)
    .join(' ');
}

program.description('Show information about the current build config');

program
  .command('current')
  .description('Show the current build config')
  .option('-n, --no-name', "Don't show config name")
  .option('-g, --git', 'Human-readable git status (tag, branch, commit)', false)
  .option('-f, --filepath', 'Config filepath', false)
  .action((options) => {
    try {
      const name = evmConfig.currentName();
      const parts = [];
      if (options.name) parts.push(color.config(name));
      if (options.git) parts.push(color.git(gitStatus(evmConfig.current())));
      if (options.filepath) parts.push(color.path(evmConfig.pathOf(name)));
      const txt = parts.join(', ');
      if (txt) console.log(txt);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('configs')
  .alias('ls')
  .description('Show installed build config')
  .action(() => {
    let current;
    try {
      current = evmConfig.currentName();
    } catch {
      // maybe there is no current config
    }
    try {
      const names = evmConfig.names();
      if (names.length === 0) {
        console.log('No build configs found. (You can create one with `e init`)');
      } else {
        names
          .sort()
          .map((name) => `${name === current ? '*' : ' '} ${color.config(name)}`)
          .forEach((name) => console.log(name));
      }
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('depotdir')
  .description('Show path of the depot-tools directory')
  .action(() => console.log(depot.path));

program
  .command('env')
  .description('Show environment variables set when building Electron')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const { env } = depot.opts(evmConfig.current());

      // This command shows the difference between the current
      // process.env and the env that is needed for running commands
      for (const key of Object.keys(env)) {
        if (process.env[key] === env[key]) {
          delete env[key];
        }
      }

      if (options.json) {
        console.log(JSON.stringify(env, null, 2));
      } else {
        const exportKeyword = os.platform() === 'win32' ? 'set' : 'export';
        const logger = ([key, val]) => console.log(`${exportKeyword} ${key}=${val}`);
        Object.entries(env).forEach(logger);
      }
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('exe')
  .alias('exec')
  .description(`Show the Electron executable's path`)
  .action(() => {
    try {
      console.log(color.path(evmConfig.execOf(evmConfig.current())));
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('root')
  .description('Show path of the top directory - home of the .gclient file')
  .action(() => {
    try {
      console.log(color.path(evmConfig.current().root));
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('src [name]')
  .description('Show path of the named (default:electron) src directory e.g. "/$root/src/electron"')
  .action((name) => {
    try {
      const { root } = evmConfig.current();
      name = name || 'electron';
      console.log(color.path(path.resolve(root, 'src', name)));
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('out')
  .description('Show outdir name, e.g. "Testing"')
  .option('--path', 'Output absolute path to outdir')
  .action((options) => {
    try {
      if (options.path) {
        console.log(color.path(evmConfig.outDir(evmConfig.current())));
      } else {
        console.log(evmConfig.current().gen.out);
      }
    } catch (e) {
      fatal(e);
    }
  });

program.parse(process.argv);
