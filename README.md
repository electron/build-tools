# Electron GN Scripts

This repository contains some helper/wrapper scripts to make working with GN easier, especially on Windows.

## Installation

### macOS / Linux

```sh
git clone https://github.com/MarshallOfSound/electron-gn-scripts.git
export PATH="$PATH:$PWD/electron-gn-scripts/nix"

# You should probably add this to your `~/.profile` too:
export PATH="$PATH:/path/to/electron-gn-scripts/nix"
```

### Windows

```batch
git clone https://github.com/MarshallOfSound/electron-gn-scripts.git
cd electron-gn-scripts\win
set PATH="%PATH%;%CD%"
```

On Windows, you'll also need to install [`depot_tools`](https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up) as outlined in the [GN Build Instructions](https://github.com/electron/electron/blob/master/docs/development/build-instructions-gn.md) and summarized here:

 1. Download the `depot_tools` [bundle](https://storage.googleapis.com/chrome-infra/depot_tools.zip) and extract it to `C:\workspace\depot_tools`
 2. Add `depot_tools` to the start of your `PATH` (must be ahead of any installs of Python)
 3. From a cmd.exe shell, run the command `gclient` (with **no** arguments)

## Initial Electron Setup

After the installation steps above, getting and building Electron only
takes the `e` command:

```sh
cd /path/to/your/developer/folder

# This will create a new "electron" folder in the current directory
# It will set up a new evm config
# Sync down all the required code and bootstrap the output directory
e fetch

e build
```

## Usage

The main command is just called `e`, all sub-commands are `git` sub-command style.  I.e. `e command ...args`

### `e sync`

**If you ran `e fetch`, you can skip this step.**

This command is the equivalent to `gclient sync`. Any addition args passed to this command are appended to the sync command.

Some possible extra arguments include:

* `--output-json` - Output a json document to this path containing summary information about the sync.
* `--no-history` - Reduces the size/time of the checkout at the cost of no history.
* `--ignore_locks` - Ignore cache locks.

Basic Usage:

```sh
e sync
```

Example Usage with extra arguments:

```sh
e sync --ignore_locks
```

### `e bootstrap`

**If you ran `e fetch`, you can skip this step.**

This command is the equivalent of `gn gen`: it generates required output directories and ninja configurations.

```sh
e bootstrap
```

### `e build`

This command runs `ninja` in your `out` directory.

It defaults to building Electron, but you can pass a single argument to this command to change what gets built.

* `electron`: Builds the Electron binary
* `electron:dist`: Builds the Electron binary and generates a dist zip file
* `mksnapshot`: Builds the `mksnapshot` binary
* `chromedriver`: Builds the `chromedriver` binary
* `node:headers`: Builds the node headers `.tar.gz` file
* `breakpad`: Builds the breakpad `dump_syms` binary

**You probably only want to run the default command with no apppended arguments**

Example Usage:

```sh
# Default - build Electron itself
e build
```

```sh
# Build the Electron binary and generates a dist zip file
e build electron:dist
```

```sh
# Build the mksnapshot binary
e build mksnapshot
```

```sh
# Build the chromedriver binary
e build chromedriver
```

```sh
# Build the node headers .tar.gz file
e build node:headers
```

```sh
# Build the breakpad `dump_syms` binary
e build breakpad
```

### `e start`

Starts the generated Electron binary, passes all extra arguments directly through to Electron.  E.g.

```sh
e start --version
e start path/to/my/app
```

### `e test`

This commands runs the Electron tests using the generated Electron binary. It passes all extra arguments directly to the spec runner.

Possible Extra Arguments:
* `--ci` - Runs Electron's tests in CI mode.
* `--runners=remote` - Only runs Electron's tests in the Renderer Process (found in the [`spec`](https://github.com/electron/electron/tree/master/spec)).
* `--runners=main` - Only runs Electron's tests in the Main Process (found in the [`spec-main`](https://github.com/electron/electron/tree/master/spec-main)).

Basic Usage:

```sh
e test
```

Example Extra Arguments:

```sh
# Run Main Process tests in CI mode 
e test --ci --runners=main
```

### `e debug`

Initializes [lldb](https://lldb.llvm.org/) (on macOS) or [gdb](https://www.gnu.org/software/gdb/) (on Linux) with the debug target set to your local Electron build.

```sh
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

### `e show`

Returns information about the current build.
Useful in combination other shell tools.
 * `e show exe`: the path of the built Electron executable
 * `e show out`: the 'out' directory name
 * `e show src [code]`: the path to the source of the specified code (default:electron)

Example Usage:

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
$ cd `e show src base`
$ pwd
/home/username/electron-gn-root/src/base
$ ripgrep --t h TakeHeapSnapshot `e show src`
```

## Multiple Configs

If you're doing a lot of Electron development and constantly switching targets or branches it is a good idea to
have multiple configurations with different out directories or `buildType`'s.  You can easily switch between configs
using `evm`.

If you copy your `config.yml` and name the copy `config.debug.yml` you can switch to that config using

```sh
evm debug
e build
```

You can have as many config files as you want and switch to them at any time using `evm $CONFIG_NAME`.
