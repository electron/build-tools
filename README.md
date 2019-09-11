# Electron GN Scripts

This repository contains some helper / wrapper scripts I've written to make working with GN easier, especially on Windows.

## Installation

### macOS / Linux

```bash
git clone https://github.com/MarshallOfSound/electron-gn-scripts.git
cd electron-gn-scripts
yarn
# You could also use `npm install` here
# You should probably add this to your path in your `.zshrc` or `.bashrc`
export PATH="$PATH:$(pwd)/nix"
```

### Windows

```batch
git clone https://github.com/MarshallOfSound/electron-gn-scripts.git
cd electron-gn-scripts
set PATH="%PATH%;"
```

## Setup

This toolset does not yet have the ability to initialize an Electron GN setup from scratch so you'll have to
do the initial work.  These steps are outlined in the [GN Build Instructions](https://github.com/electron/electron/blob/master/docs/development/build-instructions-gn.md) and summarized below.

1. [Setup `depot_tools`](https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up) for your system, ensure it's added to your path
2. That's it, yup, `e` will take over from here

## First Run

```bash
cd my-projects-folder
# This will create a new "electron" folder in the current directory
# It will set up a new evm config
# Sync down all the required code and bootstrap the output directory
e fetch

# Once run you just have to use `e build` and friends to actually build your newly cloned Electron setup.
```

## Just make it go

```bash
e sync
e bootstrap
e build
e start
```

## Usage

The main command is just called `e`, all sub-commands are `git` sub-command style.  I.e. `e command ...args`

### `e sync`

Equivilent of `gclient sync`, any addition args passed to this command are appended to the sync command

### `e bootstrap`

Equivilent of `gn gen`, generated required output directories and ninja configurations.`

### `e build`

Runs `ninja` in your out directory, defaults to building Electron.  You can pass a single argument to this command to change what gets build.

* `electron`: Builds the Electron binary
* `electron:dist`: Builds the Electron binary and generates a dist zip file
* `mksnapshot`: Builds the `mksnapshot` binary
* `chromedriver`: Builds the `chromedriver` binary
* `node:headers`: Builds the node headers `.tar.gz` file
* `breakpad`: Builds the breakpad `dump_syms` binary

### `e start`

Starts the generated Electron binary, passes all extra arguments directly through to Electron.  E.g.

```bash
e start path/to/my/app

e start --version
```

### `e test`

Runs the Electron tests using the generated Electron binary, passes all extra arguments directly to the spec runner. E.g.

```bash
e test

# My personal preference is to run with `--ci`
e test --ci
```

### `e debug`

Initializes [lldb](https://lldb.llvm.org/) (on macOS) or [gdb](https://www.gnu.org/software/gdb/) (on Linux) with the debug target set to your local Electron build.

```bash
e debug

# You should then see (on macOS, for example):
# (lldb) target create "/Users/codebytere/Developer/electron-gn/src/out/Testing/Electron.app/Contents/MacOS/Electron"
#Current executable set to '/Users/codebytere/Developer/electron-gn/src/out/Testing/Electron.app/Contents/MacOS/Electron' (x86_64).
# (lldb) < you can now run debug commands here>
```

Debugging Resources:
* `lldb` [Tutorial](https://lldb.llvm.org/use/tutorial.html)
* `gdb` [Tutorial](https://web.eecs.umich.edu/~sugih/pointers/summary.html)

**Nota Bene:** This works on macOS and Linux only.

### `e export-patches [patch-dir]`

Exports patches to the desired patch folder in Electron source tree.

Valid patch directories include:
* `node`
* `v8`
* `boringssl`
* `chromium`

**Nota Bene:** You need to be running at least Bash v4 to use this command.

## Multiple Configs

If you're doing a lot of Electron development and constantly switching targets or branches it is a good idea to
have multiple configurations with different out directories or `buildType`'s.  You can easily switch between configs
using `evm`.

If you copy your `config.yml` and name the copy `config.debug.yml` you can switch to that config using

```bash
evm debug
e build
```

You can have as many config files as you want and switch to them at any time using `evm $CONFIG_NAME`.
