# Electron GN Scripts

This repository contains helper/wrapper scripts to make working with GN
easier, especially on Windows.

## Installation

A handful of prerequisites, such as git, python, and npm, are
required. See [Platform Prerequisites][platform-prerequisites] for
more details. Once they're installed, clone a copy of `build-tools`
and add it to your path:

```sh
# get build-tools:
git clone https://github.com/electron/build-tools.git
cd build-tools
npm install

# then, on Darwin / Linux:
export PATH="$PATH:$PWD/src"
# You should probably add this to your `~/.profile` too:
export PATH="$PATH:/path/to/build-tools/src"

# then, on Windows:
cd src
set PATH=%CD%;%PATH%
```

## Getting the Code and Building Electron

After installing build-tools, you can run a new Electron build with this command:

```sh
# The 'Hello, World!' of build-tools: get and build `master`

e init --root=/path/to/new/electron/directory --bootstrap testing
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

```
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

`e sync` is usually all you need. Any extra args are passed along to gclient,
so for example `e sync -v` runs gclient verbosely.

```sh
$ e show current
master-testing
$ e show root
~/src/electron
$ e sync -v
Running "gclient sync --with_branch_heads --with_tags -v" in '~/src/electron/src'
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

```
$ uname
Linux
$ e debug
Reading symbols from /home/yourname/electron/gn/master/src/out/Testing/electron...
(gdb)
```

```
$ uname
Darwin
$ e debug
target create "/Users/yourname/electron-gn/src/out/Testing/Electron.app/Contents/MacOS/Electron"
(lldb)
```

### `e test`

Starts the local Electron build's test runner. Any extra args are passed
along to the runner.

```
# run all tests
e test

# Run main process tests
e test --runners=main
```

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
| e show stats      | SCCache build statistics                                       |

Example usage:

```
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
$ cd `e show src base`
$ pwd
/home/username/electron-gn-root/src/base
$ ripgrep --t h TakeHeapSnapshot `e show src`
```

### `e export-patches [patch-dir]`

Exports patches to the desired patch folder in Electron source tree.

Valid patch directories include:

* `node`
* `v8`
* `boringssl`
* `chromium`

[depot-tools]: https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up
[gdb]: https://web.eecs.umich.edu/~sugih/pointers/summary.html
[gn-configs]: https://github.com/electron/electron/tree/master/build/args
[gn]: https://chromium.googlesource.com/chromium/src/tools/gn/+/48062805e19b4697c5fbd926dc649c78b6aaa138/README.md
[lldb]: https://lldb.llvm.org/use/tutorial.html
[ninja]: https://ninja-build.org
[nvm]: https://github.com/nvm-sh/nvm
[platform-prerequisites]: https://electronjs.org/docs/development/build-instructions-gn#platform-prerequisites
[sanitizers]: https://github.com/google/sanitizers
