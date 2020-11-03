#!/usr/bin/env node

const childProcess = require('child_process');
const open = require('open');
const os = require('os');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');
const goma = require('./utils/goma');

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
    .map(out => out.trim())
    .filter(out => out)
    .join(' ');
}

program.description('Show information about the current build config');

program
  .command('current')
  .description('Name of the current build config')
  .option('-n, --no-name', "Don't show config name", false)
  .option('-g, --git', 'Human-readable git status (tag, branch, commit)', false)
  .option('-f, --filename', 'Config filename', false)
  .action(options => {
    try {
      const name = evmConfig.currentName();
      const parts = [];
      if (options.name) parts.push(color.config(name));
      if (options.git) parts.push(color.git(gitStatus(evmConfig.current())));
      if (options.filename) parts.push(color.path(evmConfig.pathOf(name)));
      const txt = parts.join(', ');
      if (txt) console.log(txt);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('configs')
  .alias('ls')
  .description('Installed build config')
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
          .map(name => `${name === current ? '*' : ' '} ${color.config(name)}`)
          .forEach(name => console.log(name));
      }
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('depotdir')
  .description('Path of the depot-tools directory')
  .action(() => console.log(depot.path));

program
  .command('env')
  .description('Environment variables set when building Electron')
  .option('--json', 'Output as JSON')
  .action(options => {
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
  .description(`Electron executable's path`)
  .action(() => {
    try {
      console.log(color.path(evmConfig.execOf(evmConfig.current())));
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('root')
  .description('Path of the top directory. Home of the .gclient file')
  .action(() => {
    try {
      console.log(color.path(evmConfig.current().root));
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('src [name]')
  .description('Path of the named (default:electron) src directory e.g. "/$root/src/electron"')
  .action(name => {
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
  .description('outdir name, e.g. "Testing"')
  .action(() => {
    try {
      console.log(evmConfig.current().gen.out);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('outdir')
  .description('outdir path, e.g. "/$root/src/out/Testing"`')
  .action(() => {
    try {
      console.log(color.path(evmConfig.outDir(evmConfig.current())));
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('stats')
  .description('build statistics')
  .action(() => {
    try {
      const config = evmConfig.current();
      const options = {
        env: { ...process.env, ...config.env, ...goma.env(config) },
        stdio: 'inherit',
        cwd: goma.dir,
      };
      childProcess.execFileSync('python', ['goma_ctl.py', 'stat'], options);
    } catch (e) {
      fatal(e);
    }
  });

const gomaUrl = 'http://localhost:8088/';
program
  .command('goma')
  .description(`Watch Goma at work at ${gomaUrl}`)
  .action(async () => {
    try {
      await open(gomaUrl);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('gomadir')
  .description('Path of the goma directory')
  .action(() => console.log(goma.dir));

program
  .command('gomagn')
  .description('Path of the goma.gn file')
  .action(() => console.log(goma.gnFilePath));

program.parse(process.argv);

if (process.argv.length < 3) {
  program.outputHelp();
}
