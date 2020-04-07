# Electron GN Scripts

This repository contains helper/wrapper scripts to make working with GN
easier, especially on Windows.

## Installation

A handful of prerequisites, such as git, python, and npm, are
required for building Electron itself; these can be found in 
[Platform Prerequisites][platform-prerequisites]. `npm` can be used
with `build-tools` itself as well, but we've configured it to run
with `yarn`, so we also recommend you [install it to your system](https://yarnpkg.com/lang/en/docs/install/).

From here, you'll need a command-line prompt. On Mac and Linux, this will
be a terminal with a shell, e.g. bash or zsh. You can also use these on
Windows if you install them, or use built-in tools like Windows'
[Command Prompt](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/windows-commands#command-shell-overview).

Please note that `build-tools` (due to nested dependencies) might not work properly in powershell, please use `cmd` on Windows for optimum results.

Once they're installed, clone a copy of `build-tools`
and add it to your path:

```sh
# get build-tools:
git clone https://github.com/electron/build-tools.git
cd build-tools
yarn install

# then, if on Darwin / Linux:
export PATH="$PATH:$PWD/src"
# You should probably add this to your `~/.profile` too:
export PATH="$PATH:/path/to/build-tools/src"

# then, if in Windows' Command Prompt:
cd src
set PATH=%CD%;%PATH%
```

## Getting the Code and Building Electron

You can run a new Electron build with this command:

```sh
# The 'Hello, World!' of build-tools: get and build `master`

# On macOS if you aren't sure you have the right SDK version you should run
# Also on macOS if you are using Goma this is a _requirement_
e load-xcode

# Choose the directory where Electron's source and build files will reside.
# You can specify any path you like; this command defaults to ~/projects/electron.
# If you're going to use multiple branches, you may want something like:
# `--root=~/electron/branch` (e.g. `~/electron-gn/master`)
e init --root=~/electron --bootstrap testing
```

That command's going to run for awhile. While you're waiting, grab a
cup of hot caffeine and read about what your computer is doing:

### Concepts

Electron's build-tools command is named `e`. Like [nvm][nvm] and git,
you'll invoke e with commands and subcommands. See `e --help` or `e help <cmd>`
for many more details.

`e` also borrows another inspiration from nvm: having multiple configurations
that you can switch between so that one is the current, active configuration.
Many choices go into an Electron build:

* Which [Electron branch](https://github.com/electron/electron/branches)
  is used (e.g. `master`, `7-0-x`)
* Which [.gn config file][gn-configs] is imported (e.g.
  [testing](https://github.com/electron/electron/blob/master/build/args/testing.gn) or
  [release](https://github.com/electron/electron/blob/master/build/args/release.gn))
* Any compile-time options (e.g. Clang's [asan or tsan][sanitizers])

`e` holds all these variables together in a build configuration. You can
have multiple build configurations and manage them in a way similar to nvm:

| nvm                  | e                  | Description                                    |
|:---------------------|:-------------------|:-----------------------------------------------|
| nvm ls               | e show configs     | Show the available configurations              |
| nvm current          | e show current     | Show which configuration is currently in use   |
| nvm use &lt;name&gt; | e use &lt;name&gt; | Change which configuration is currently in use |

Getting the source code is a lot more than cloning `electron/electron`.
Electron is built on top of Chromium (with Electron patches) and Node
(with more Electron patches). A source tree needs to have all of the
above **and** for their versions to be in sync with each other. Electron
uses Chromium's [Depot Tools][depot-tools] and [GN][gn] for wrangling
and building the code. `e` wraps these tools:

| Command | Description                                                    |
|:--------|:---------------------------------------------------------------|
| e init  | Create a new build config and initialize a GN directory        |
| e sync  | Get / update / synchronize source code branches                |
| e build | Build it!                                                      |

### e init

New build configs are created with `e init`. It has several command-line
options to specify the build configuration, e.g. the path to the source
code, compile-time options, and so on. See `e init --help` for in-depth
details.

Each build config has a name, chosen by you to use as a mnemonic when
switching between build configs with `e use <name>`. This is the name's
only purpose, so choose whatever you find easiest to work with &mdash;
whether it's `electron`, `6-1-x--testing`, or `chocolate-onion-popsicle`.

Each build also needs a root directory. All the source code and built
files will be stored somewhere beneath it. `e init` uses `$PWD/electron`
by default, but you can choose your own with `--root=/some/path`. If you
want to make multiple build types of the same branch, you can reuse
an existing root to share it between build configs.

As an example, let's say you're starting from scratch and want both
testing and release builds of the master branch in `electron/electron`.
You might do this:

```sh
# making 'release' and 'testing' builds from master

$ e init master-testing -i testing --root=~/src/electron
Creating '~/src/electron'
New build config 'master-testing' created
Now using config 'master-testing'
$ e show current
master-testing

$ e init master-release -i release --root=~/src/electron
INFO Root '~/src/electron' already exists.
INFO (OK if you are sharing $root between multiple build configs)
New build config 'master-release' created
Now using config 'master-release'

$ e show configs
* master-release
  master-testing

$ e show current
master-release
$ e show root
~/src/electron

$ e use master-testing
Now using config 'master-testing'
$ e show current
master-testing
$ e show root
~/src/electron
```

As a convenience, `e init --bootstrap` will run `e sync` and `e build`
after creating the build config. Let's see what those do:

### `e sync`

'e sync' is a wrapper around 'gclient sync' from [Depot Tools][depot-tools].
If you're starting from scratch, this will (slowly) fetch all the source
code. It's also useful after switching Electron branches to synchronize
the rest of the sources to the versions needed by the new Electron branch.

`e sync` is usually all you need. Any extra args are passed along to gclient itself.

```sh
$ e show current
master-testing

$ e show root
~/src/electron

$ e sync
Running "gclient sync --with_branch_heads --with_tags" in '~/src/electron/src'
[sync output omitted]
```

To make your output more verbose, you can add an increasing number of `-v`s. For example,

```sh
# basic verbosity
$ e sync -v
Running "gclient sync --with_branch_heads --with_tags -v" in '~/src/electron/src'
[sync output omitted]

# significant verbosity
$ e sync -vvvv
Running "gclient sync --with_branch_heads --with_tags -vvvv" in '~/src/electron/src'
[sync output omitted]
```

### `e build`

Once you have the source, the next step is to build it with `e build [target]`.
These build targets are supported:

| Target        | Description                                              |
|:--------------|:---------------------------------------------------------|
| breakpad      | Builds the breakpad `dump_syms` binary                   |
| chromedriver  | Builds the `chromedriver` binary                         |
| electron      | Builds the Electron binary **(Default)**                 |
| electron:dist | Builds the Electron binary and generates a dist zip file |
| mksnapshot    | Builds the `mksnapshot` binary                           |
| node:headers  | Builds the node headers `.tar.gz` file                   |

As with syncing, `e build [target]` is usually all you need. Any extra
args are passed along to [ninja][ninja], so for example `e build -v`
runs a verbose build.

## Using Electron

After you've built Electron, it's time to use it!

| Command | Description                          |
|:--------|:-------------------------------------|
| e start | Run the Electron build               |
| e node  | Run the Electron build as Node       |
| e debug | Run the Electron build in a debugger |
| e test  | Run Electron's spec runner           |

As usual, any extra args are passed along to the executable. For example,
`e node --version` will print out Electron's node version.

### `e debug`

Runs your local Electron build inside of [lldb][lldb] or [gdb][gdb].

```sh
$ uname
Linux
$ e debug
Reading symbols from /home/yourname/electron/gn/master/src/out/Testing/electron...
(gdb)
```

```sh
$ uname
Darwin

$ e debug
target create "/Users/yourname/electron-gn/src/out/Testing/Electron.app/Contents/MacOS/Electron"
(lldb)
```

### `e test`

Starts the local Electron build's test runner. Any extra args are passed
along to the runner.

```sh
# run all tests
e test

# run main process tests
e test --runners=main
```

Possible extra arguments to pass:
* `--node` - Run Node.js' own tests with Electron in `RUN_AS_NODE` mode.
* `--runners=<main|remote|native>` - The set of tests to run, can be either `main`, `remote`, or `native`.

## Getting Information

`e show` shows information about the current build config.

| Command           | Description                                                    |
|:------------------|:---------------------------------------------------------------|
| e show current    | The name of the active build config                            |
| e show configs    | Lists all build configs                                        |
| e show env        | Show environment variables injected by the active build config |
| e show exe        | The path of the built Electron executable                      |
| e show root       | The path of the root directory from `e init --root`.           |
| e show src [name] | The path of the named (default: electron) source dir           |
| e show stats      | Build statistics                                               |

Example usage:

```sh
$ uname
Darwin

$ e show exe
/Users/username/electron-gn-root/src/out/Testing/Electron.app/Contents/MacOS/Electron

$ uname
Linux

$ e show exe
/home/username/electron-gn-root/src/out/Testing/electron

$ e show out
Testing

$ e show src
/home/username/electron-gn-root/src/electron

$ cd `e show src base` && pwd
/home/username/electron-gn-root/src/base

$ ripgrep --t h TakeHeapSnapshot `e show src`
```

### `e patches [patch-dir]`

Exports patches to the desired patch folder in Electron source tree.

Valid patch directories can include:

* `node`
* `v8`
* `boringssl`
* `chromium`
* `perfetto`
* `icu`

| Command              | Source Directory                   | Patch Directory                   |
|:---------------------|:-----------------------------------|:----------------------------------|
| e patches node       | `src/third_party/electron_node`    | `src/electron/patches/node`       |
| e patches chromium   | `src`                              | `src/electron/patches/chromium`   |
| e patches boringssl  | `src/third_party/boringssl/src`    | `src/electron/patches/boringssl`  |
| e patches v8         | `src/v8`                           | `src/electron/patches/v8`         |
| e patches perfetto   | `src/third_party/perfetto`         | `src/electron/patches/perfetto`   |
| e patches icu        | `src/third_party/icu`              | `src/electron/patches/icu`        |

[depot-tools]: https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up
[gdb]: https://web.eecs.umich.edu/~sugih/pointers/summary.html
[gn-configs]: https://github.com/electron/electron/tree/master/build/args
[gn]: https://chromium.googlesource.com/chromium/src/tools/gn/+/48062805e19b4697c5fbd926dc649c78b6aaa138/README.md
[lldb]: https://lldb.llvm.org/use/tutorial.html
[ninja]: https://ninja-build.org
[nvm]: https://github.com/nvm-sh/nvm
[platform-prerequisites]: https://electronjs.org/docs/development/build-instructions-gn#platform-prerequisites
[sanitizers]: https://github.com/google/sanitizers

## Advanced Usage

### Per-Session Active Configs

If you want your shell sessions to each have different active configs, try this in your `~/.profile` or `~/.zshrc` or `~/.bashrc`:

```sh
if [[ -z "${EVM_CURRENT_FILE}" ]]; then
  export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
fi
```

This will create per-shell temporary files in which he active config file can be changed with `e use`.

