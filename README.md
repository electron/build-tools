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

1. [Setup `depot_tools`]() for your system, ensure it's added to your path
  i) Don't worry about setting `DEPOT_TOOLS_WIN_TOOLCHAIN=0` on Windows
2. Initialize a repository with `gclient config`
  i) `mkdir electron-gn && cd electron-gn && gclient config --name "src/electron" --unmanaged https://github.com/electron/electron`
3. That's it, yup, `e` will take over from here

Once you've set up `depot_tools` and run `gclient config` you just need to create a `config.yml` file in the root of this repository.
You can see `config.example.yml` for what information you need to fill out.  Once that file is ready just run `e generate-config`.

You're now ready to go!!

## Just make it go

```bash
e sync
e bootstrap
e build
e start
```

## Usage

The main command is just called `e`, all sub-commands are `git` sub-command style.  I.e. `e command ...args`

### `e generate-config`

Generates the configuration files based on your `config.yml` that all the other commands require.  If you don't run this at least
once all the other commands will fail.

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
