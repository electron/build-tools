# Electron Build Tools

This repository contains helper/wrapper scripts to make building Electron easier.

## Table of Contents

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Concepts](#concepts)
- [Core workflow](#core-workflow): [`init`](#e-init) · [`sync`](#e-sync) · [`build`](#e-build)
- [Running Electron](#running-electron): [`start`](#e-start) · [`node`](#e-node) · [`debug`](#e-debug) · [`test`](#e-test) · [`npm`](#e-npm)
- [Inspecting state](#inspecting-state): [`show`](#e-show) · [`shell`](#e-shell)
- [Working with code](#working-with-code): [`patches`](#e-patches) · [`open`](#e-open) · [`pr`](#e-pr) · [`backport`](#e-backport) · [`cherry-pick`](#e-cherry-pick) · [`rcv`](#e-rcv)
- [Managing configs](#managing-configs): [`use`](#e-use) · [`remove`](#e-remove) · [`sanitize-config`](#e-sanitize-config) · [`worktree`](#e-worktree) · [`load-macos-sdk`](#e-load-macos-sdk)
- [Infrastructure](#infrastructure): [`depot-tools`](#e-depot-tools) · [`gh-auth`](#e-gh-auth) · [`auto-update`](#e-auto-update)
- [Configuration file reference](#configuration-file-reference)
- [Environment variables](#environment-variables)
- [Shell completion](#shell-completion)
- [Advanced](#advanced)

## Installation

A handful of prerequisites, such as git, python, and npm, are required for building Electron itself;
these can be found in [Platform Prerequisites][platform-prerequisites]. `npm` can be used with
`build-tools` itself as well, but we've configured it to run with `yarn`, so we also recommend you
[install it to your system](https://yarnpkg.com/lang/en/docs/install/).

From here, you'll need a command-line prompt. On Mac and Linux, this will be a terminal with a
shell, e.g. bash or zsh. You can also use these on Windows if you install them, or use built-in
tools like Windows' [Command Prompt](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/windows-commands#command-shell-overview).

Please note that `build-tools` (due to nested dependencies) might not work properly in PowerShell;
please use `cmd` on Windows for optimum results.

```sh
# Install build-tools package globally:
npm i -g @electron/build-tools
```

> [!NOTE]
> The `@electron/build-tools` npm package is a thin wrapper for the actual `build-tools` scripts.
> Its code lives in the [electron/build-tools-installer](https://github.com/electron/build-tools-installer) repository.

## Quickstart

```sh
# The 'Hello, World!' of build-tools: get and build `main`
# Choose the directory where Electron's source and build files will reside.
# You can specify any path you like; this command defaults to `$PWD/electron`.
# If you're going to use multiple branches, you may want something like:
# `--root=~/electron/branch` (e.g. `~/electron-gn/main`)
e init --root=~/electron --bootstrap testing
```

That command's going to run for awhile. While you're waiting, grab a cup of hot caffeine and read
about what your computer is doing.

## Concepts

Electron's build-tools command is named `e`. Like [nvm][nvm] and git, you'll invoke `e` with
commands and subcommands. See `e --help` or `e help <cmd>` for more details on any command.

`e` also borrows another inspiration from nvm: having multiple configurations that you can switch
between so that one is the current, active configuration. Many choices go into an Electron build:

- Which [Electron branch](https://github.com/electron/electron/branches) is used (e.g. `main`, `36-x-y`)
- Which [.gn config file][gn-configs] is imported (e.g. [testing](https://github.com/electron/electron/blob/main/build/args/testing.gn) or [release](https://github.com/electron/electron/blob/main/build/args/release.gn))
- Any compile-time options (e.g. Clang's [asan or tsan][sanitizers])

`e` holds all these variables together in a build configuration. You can have multiple build
configurations and manage them in a way similar to nvm:

| nvm                  | e                  | Description                                    |
|:---------------------|:-------------------|:-----------------------------------------------|
| nvm ls               | e show configs     | Show the available configurations              |
| nvm current          | e show current     | Show which configuration is currently in use   |
| nvm use &lt;name&gt; | e use &lt;name&gt; | Change which configuration is currently in use |

To run a single command against a config other than the current one without switching, pass
`--config=<name>` as the first argument:

```sh
$ e --config=my-release build
$ e --config=main-debug show root
```

Getting the source code is a lot more than cloning `electron/electron`. Electron is built on top of
Chromium (with Electron patches) and Node (with more Electron patches). A source tree needs to have
all of the above **and** for their versions to be in sync with each other. Electron uses Chromium's
[Depot Tools][depot-tools] and [GN][gn] for wrangling and building the code. `e` wraps these tools:

| Command | Description                                                    |
|:--------|:---------------------------------------------------------------|
| e init  | Create a new build config and initialize a GN directory        |
| e sync  | Get / update / synchronize source code branches                |
| e build | Build it!                                                      |

## Core workflow

### `e init`

Create a new local development environment for Electron.

```sh
$ e init [options] <name>
```

Each build config has a name, chosen by you to use as a mnemonic when switching between build
configs with `e use <name>`. This is the name's only purpose, so choose whatever you find easiest to
work with &mdash; whether it's `electron`, `36-x-y--testing`, or `chocolate-onion-popsicle`.

Each build also needs a root directory. All the source code and built files will be stored
somewhere beneath it. `e init` uses `$PWD/electron` by default, but you can choose your own with
`--root=/some/path`. If you want to make multiple build types of the same branch, you can reuse an
existing root to share it between build configs.

**Options**

| Option                       | Description                                                                      |
|:-----------------------------|:---------------------------------------------------------------------------------|
| `-r, --root <path>`          | Root for source and build files (default: `$PWD/electron`)                       |
| `-i, --import <name>`        | GN args file to import from `build/args/<name>.gn` (default: `testing`)          |
| `-o, --out <name>`           | Output directory name under `$root/src/out/` (default: capitalized `--import`)   |
| `-f, --force`                | Overwrite an existing build config with the same name                            |
| `--asan`, `--tsan`, `--msan`, `--lsan` | Enable Clang's address / thread / memory / leak sanitizer                |
| `--mas`                      | Build for the macOS App Store (macOS only)                                       |
| `--target-cpu <arch>`        | Target architecture: `x86`, `x64`, `arm`, `arm64`                                |
| `--bootstrap`                | Run `e sync` and `e build` immediately after creating the config                 |
| `--remote-build <target>`    | Remote-execution backend: `siso` (default) or `none`                             |
| `--use-https`                | Set git remotes with `https://` URLs instead of `git@github.com:`                |
| `--fork <user/electron>`     | Add a remote named `fork` pointing at the given GitHub fork                      |

**Example**

As an example, let's say you're starting from scratch and want both testing and release builds of
the main branch in `electron/electron`. You might do this:

```sh
# making 'release' and 'testing' builds from main

$ e init main-testing -i testing --root=~/src/electron
Creating '~/src/electron'
New build config 'main-testing' created
Now using config 'main-testing'
$ e show current
main-testing

$ e init main-release -i release --root=~/src/electron
INFO Root '~/src/electron' already exists.
INFO (OK if you are sharing $root between multiple build configs)
New build config 'main-release' created
Now using config 'main-release'

$ e show configs
* main-release
  main-testing

$ e use main-testing
Now using config 'main-testing'
```

As a convenience, `e init --bootstrap` will run `e sync` and `e build` after creating the build
config. On macOS, `e init` also loads the required macOS SDKs.

### `e sync`

Fetch or update the source tree.

```sh
$ e sync [--3] [gclientArgs...]
```

`e sync` is a wrapper around `gclient sync` from [Depot Tools][depot-tools]. If you're starting
from scratch, this will (slowly) fetch all the source code. It's also useful after switching
Electron branches to synchronize the rest of the sources to the versions needed by the new Electron
branch.

Any extra args are passed along to gclient. To make your output more verbose, you can add an
increasing number of `-v`s (e.g. `e sync -v`, `e sync -vvvv`).

**Options**

| Option             | Description                                                                     |
|:-------------------|:--------------------------------------------------------------------------------|
| `--3, --three-way` | Apply Electron patches using a three-way merge. Useful when upgrading Chromium. |

### `e build`

Build an Electron executable.

```sh
$ e build [options] [ninjaArgs...]
```

Once you have the source, the next step is to build it. Running `e build` with no target will build
`electron` by default.

To see an exhaustive list of all possible build targets, run `e d gn ls out/<out>`, where `<out>`
is e.g. `Testing` or `Release` depending on your build type. This will log a long list of targets
to the console and also allow you to build some of Chromium's targets.

Any extra args are passed along to [ninja][ninja], so for example `e build -v` runs a verbose
build.

**Options**

| Option                 | Description                                                                                         |
|:-----------------------|:----------------------------------------------------------------------------------------------------|
| `-t, --target <target>`| Build a specific ninja target (default: `electron`, or `defaultTarget` from the config)             |
| `--gen <mode>`         | Control `gn gen`: `on` (default, re-runs if args changed), `off` (skip), or `only` (run and exit)   |
| `--no-remote`          | Build entirely locally, disabling RBE / remote execution                                            |

**Commonly used targets**

| Target                               | Description                                              |
|:-------------------------------------|:---------------------------------------------------------|
| `electron`                           | Build the Electron binary **(default)**                  |
| `electron:electron_dist_zip`         | Build the Electron binary and generate a dist zip        |
| `electron:electron_chromedriver_zip` | Build the `chromedriver` binary                          |
| `electron:electron_mksnapshot_zip`   | Build the `mksnapshot` binary                            |
| `electron:node_headers`              | Build the node headers `.tar.gz`                         |
| `electron:electron_symbols`          | Generate breakpad symbols (release builds)               |
| `third_party/breakpad:dump_syms`     | Build the breakpad `dump_syms` binary                    |

For example, running `e d gn ls out/Testing | grep "//ui/views/"` will list Chromium's `//ui/views`
targets, and you can then `e build --target ui/views/examples:views_examples_with_content`.

When first run, `e build` will try to set up reclient to speed up your builds. The permission prompt
can look scary because GitHub's UI is less than optimal
([related discussion](https://github.com/orgs/community/discussions/37117)). However, Electron only
obtains user-profile access and `read:org` permission. No permission is granted to any of your
repositories or content.

## Running Electron

| Command   | Description                          |
|:----------|:-------------------------------------|
| `e start` | Run the Electron build               |
| `e node`  | Run the Electron build as Node       |
| `e debug` | Run the Electron build in a debugger |
| `e test`  | Run Electron's spec runner           |
| `e npm`   | Run an npm command with the local Electron substituted for the published one |

### `e start`

Run the local Electron executable. Alias: `e run`. Extra args are forwarded to Electron.

```sh
$ e start .
$ e start /path/to/app
$ e start /path/to/app --js-flags
```

### `e node`

Run the local Electron build as if it were Node (sets `ELECTRON_RUN_AS_NODE=1`).

```sh
$ e node --version         # prints Electron's Node version
$ e node /path/to/script.js
```

### `e debug`

Run your local Electron build inside of [lldb][lldb] (macOS) or [gdb][gdb] (Linux).

```sh
$ e debug
# Linux:
Reading symbols from /home/yourname/electron/gn/main/src/out/Testing/electron...
(gdb)

# macOS:
target create "/Users/yourname/electron-gn/src/out/Testing/Electron.app/Contents/MacOS/Electron"
(lldb)
```

### `e test`

Start the local Electron build's test runner. Any extra args are passed along to the runner.

```sh
# run all tests
$ e test

# run only main-process tests
$ e test --runners=main

# run Node.js' own test suite under Electron's `RUN_AS_NODE` mode
$ e test --node
```

**Options**

| Option                         | Description                                                                    |
|:-------------------------------|:-------------------------------------------------------------------------------|
| `--electronVersion <version>`  | Run against a published Electron release instead of your local build           |
| `--node`                       | Run the Node.js spec runner (mutually exclusive with `--nan`)                  |
| `--nan`                        | Run the NaN spec runner (mutually exclusive with `--node`)                     |
| `--runners <main\|native>`     | Run a subset of the main Electron tests                                        |
| `--disable-logging`            | Don't pass `--enable-logging` to the spec runner                               |
| `--no-remote`                  | Build test-runner components (e.g. `node_headers`) without remote execution    |

### `e npm`

Run an npm command with `ELECTRON_OVERRIDE_DIST_PATH` set so that any spawned `electron` binary is
your local from-source build instead of the one installed from npm.

```sh
$ e npm test
$ e npm run start
```

Useful for testing your local Electron against an app's existing `electron` dependency.

## Inspecting state

### `e show`

Show information about the current build config.

| Subcommand          | Description                                                                             |
|:--------------------|:----------------------------------------------------------------------------------------|
| `e show current`    | Print the active config name. `-g/--git` appends git status; `-f/--filepath` the path.  |
| `e show configs`    | List all build configs (active is marked with `*`). Alias: `e show ls`.                 |
| `e show env`        | Environment variables injected by the active config (diffed against your current env). Add `--json` for JSON. |
| `e show exe`        | Path of the built Electron executable. Alias: `e show exec`.                            |
| `e show root`       | Path of the root directory — home of `.gclient`.                                        |
| `e show src [name]` | Path of a named source dir (default: `electron`). E.g. `e show src base`.               |
| `e show out`        | The outdir name (e.g. `Testing`). Pass `--path` for the absolute path.                  |
| `e show depotdir`   | Path of the depot-tools directory that build-tools manages.                             |

**Example**

```sh
$ e show exe
/Users/username/electron-gn-root/src/out/Testing/Electron.app/Contents/MacOS/Electron

$ e show out
Testing

$ cd `e show src base` && pwd
/home/username/electron-gn-root/src/base

$ ripgrep --t h TakeHeapSnapshot `e show src`
```

### `e shell`

Launch a shell environment populated with build-tools' environment variables and context. Useful
for invoking `gn` and `ninja` directly (instead of through `e d`), for bash completion, and for
copy-pasting commands from Chromium docs unchanged.

```sh
$ e shell
# Launching build-tools shell with "/bin/zsh"
```

Not supported on Windows.

## Working with code

### `e patches`

Refresh patches in `$root/src/electron/patches/<target>`.

```sh
$ e patches <target|all>
```

**Options**

| Option               | Description                                                                                       |
|:---------------------|:--------------------------------------------------------------------------------------------------|
| `-c, --config <file>`| Override the patches config (default: `$root/src/electron/patches/config.json`)                   |
| `--list-targets`     | Print all supported patch targets                                                                 |
| `--commit-updates`   | Auto-commit non-content patch changes (rebuilt offsets, etc.). Skips files with content diffs.    |

Supported targets are defined in Electron's `patches/config.json` and typically include:

| Target      | Source Directory                   | Patch Directory                   |
|:------------|:-----------------------------------|:----------------------------------|
| `node`      | `src/third_party/electron_node`    | `src/electron/patches/node`       |
| `chromium`  | `src`                              | `src/electron/patches/chromium`   |
| `boringssl` | `src/third_party/boringssl/src`    | `src/electron/patches/boringssl`  |
| `v8`        | `src/v8`                           | `src/electron/patches/v8`         |
| `perfetto`  | `src/third_party/perfetto`         | `src/electron/patches/perfetto`   |
| `icu`       | `src/third_party/icu`              | `src/electron/patches/icu`        |

Use `e patches all` to refresh every target, or `e patches --list-targets` to see the full list for
your checkout.

### `e open`

Open the GitHub page for a commit, pull request, or issue.

```sh
$ e open <sha1|PR#>
```

`e open 0920d01` finds the commit with abbreviated sha1 `0920d01`, looks up its associated PR, and
opens `https://github.com/electron/electron/pull/<number>` in your browser. Since you can also pass
a number directly, `e open 23450` opens that PR or issue. Pass `--print` to print the URL instead.

### `e pr`

Work with pull requests to `electron/electron`.

| Subcommand              | Description                                                                                                      |
|:------------------------|:-----------------------------------------------------------------------------------------------------------------|
| `e pr open`             | Open a GitHub compare URL for creating a PR (default subcommand; `e pr` is the same).                            |
| `e pr download-dist <pr#>` | Download built artifacts from the latest Build workflow run of a PR.                                          |

**`e pr open` options**

| Option                     | Description                                                                         |
|:---------------------------|:------------------------------------------------------------------------------------|
| `-s, --source <branch>`    | Source branch (default: current HEAD)                                               |
| `-t, --target <branch>`    | Target branch (default: guessed from the Electron version in your checkout)         |
| `-b, --backport <pr#>`     | Pre-fill the PR body with notes and title from the original PR being backported     |

**`e pr download-dist` options**

| Option                     | Description                                                                                                 |
|:---------------------------|:------------------------------------------------------------------------------------------------------------|
| `--platform <platform>`    | Platform to download (default: current)                                                                     |
| `--arch <arch>`            | Architecture (default: current)                                                                             |
| `-o, --output <dir>`       | Artifact output directory (default: `~/.electron_build_tools/artifacts/pr_{number}_{hash}_{platform}_{arch}`) |
| `-s, --skip-confirmation`  | Skip the confirmation prompt (enabled automatically in CI)                                                  |

`e pr download-dist` requires a GitHub token — see [`e gh-auth`](#e-gh-auth).

### `e backport`

Assist with a manual backport for a given PR.

```sh
$ e backport <PR>
```

It reads `needs-manual-bp/*` labels on the PR to find target branches, prompts you to choose one,
checks it out, updates it, and cherry-picks the merge commit. If conflicts arise, resolve them and
continue the cherry-pick yourself; then use `e pr open --backport <PR>` to raise the backport PR.

```sh
$ e backport 1234
# select branch you want to backport PR to
30-x-y
# resolve any merge conflicts
$ git cherry-pick --continue
$ git push
$ e pr open --backport 1234
```

Requires a GitHub token — see [`e gh-auth`](#e-gh-auth).

### `e cherry-pick`

Open a PR to `electron/electron` that cherry-picks an upstream CL into our patches folder. Alias:
`e auto-cherry-pick`.

```sh
$ e cherry-pick <patch-url> <target-branch> [additionalBranchesOrUrls...]
```

Supported patch URLs are Gerrit CLs (Chromium / V8 / DevTools) and Node.js GitHub commit URLs.
You may pass multiple target branches and/or multiple patch URLs in one invocation; the tool will
bundle them into one PR per target branch.

**Options**

| Option             | Description                                                                                |
|:-------------------|:-------------------------------------------------------------------------------------------|
| `--security`       | Mark as a security backport (adjusts labels, PR template, and CVE handling)                |
| `--no-cve-lookup`  | Skip the `issues.chromium.org` CVE lookup (and the interactive cookie borrow it requires)  |

Requires a GitHub token — see [`e gh-auth`](#e-gh-auth).

### `e rcv`

Reconstruct an intermediate Chromium version from a roll PR (useful for bisecting a Chromium roll).
Alias: `e reconstruct-chromium-version`.

```sh
$ e rcv <roll-pr> [chromium-version-or-sha]
```

Fetches the Chromium versions between the roll's base and head, optionally prompts you to pick an
intermediate version, checks out the parent of the roll's merge commit, creates a branch
`rcv/pr/<pr>/version/<version>`, and cherry-picks the CLs that fall within the chosen version
range. Also regenerates generated files (`gen-hunspell-filenames.js`, `gen-libc++-filenames.js`).

**Options**

| Option                       | Description                                                                       |
|:-----------------------------|:----------------------------------------------------------------------------------|
| `--sort`                     | Sort cherry-picked commits by CL merge time                                       |
| `--merge-strategy-option`    | Git merge strategy option when cherry-picking (default: `theirs`)                 |

Requires a GitHub token — see [`e gh-auth`](#e-gh-auth).

## Managing configs

### `e use`

```sh
$ e use <name>
```

Switch the active build config.

### `e remove`

```sh
$ e remove <name>    # alias: e rm
```

Delete a build config from the list. Does not touch the source tree or build output.

### `e sanitize-config`

```sh
$ e sanitize-config [name]
```

Update an existing config to conform to the latest build-tools schema. Sometimes `build-tools` will
make changes to its config requirements; in those cases, warnings are printed and the issue is
handled temporarily at load time. Running `e sanitize-config` rewrites the file to the new format,
so the warnings go away for good. Defaults to the current config if no name is given.

### `e worktree`

Manage additional gclient working directories that share git objects with an existing checkout.
Useful when you want to iterate on multiple branches or configs simultaneously without re-syncing
full Chromium trees. Unix only (requires symlinks).

| Subcommand                            | Description                                                       |
|:--------------------------------------|:------------------------------------------------------------------|
| `e worktree add <name> <new_workdir>` | Create a new worktree + matching build config from an existing one |
| `e worktree clean <name>`             | Delete a worktree directory and its build config                   |

**`e worktree add` options**

| Option              | Description                                                                                  |
|:--------------------|:---------------------------------------------------------------------------------------------|
| `--source <config>` | Build config to clone from (default: current)                                                |
| `-o, --out <name>`  | Output directory under `$root/src/out/` (default: same as source)                            |
| `--no-sync`         | Skip running `e sync` after creating the worktree                                            |
| `-f, --force`       | Overwrite an existing build config of the same name                                          |

**`e worktree clean` options**

| Option   | Description                                                                                           |
|:---------|:------------------------------------------------------------------------------------------------------|
| `--yes`  | Confirm deletion (required — this removes the entire worktree directory)                              |

`clean` will refuse to delete a worktree that isn't symlinked from an `e worktree add`, and will
refuse to delete the currently-active config — `e use` somewhere else first.

**Example**

```sh
$ e worktree add testing2 ~/src/electron2
$ e worktree add asan ~/src/electron-asan --source testing -o Asan --no-sync
$ e worktree clean testing2 --yes
```

### `e load-macos-sdk`

```sh
$ e load-macos-sdk [version]
```

Downloads and symlinks the macOS SDK(s) required by the current config into the Chromium checkout
(may require `sudo`). Called automatically by `e init`, `e sync`, and `e build` on macOS; you'll
rarely need to run it directly. The config's `preserveSDK` field controls how many recent SDKs are
kept on disk (default: 5).

## Infrastructure

### `e depot-tools`

```sh
$ e depot-tools <depotToolsArgs...>    # alias: e d
```

Run a command against the depot-tools checkout that `build-tools` manages, with the environment
set up correctly for the current config. Some useful examples:

```sh
# run gclient sync directly
$ e d gclient sync

# login to reclient
$ e d rbe login

# check reclient status
$ e d rbe status

# list all GN build args
$ e d gn args --list -C out/Testing
```

`e d auto-update enable|disable` toggles auto-updates for depot-tools itself (separate from
build-tools' own auto-update).

### `e gh-auth`

```sh
$ e gh-auth [--shell]
```

Generate a device-flow OAuth token for the Electron GitHub org. The token is used by `e pr`,
`e backport`, `e cherry-pick`, and `e rcv`.

Pass `--shell` to print an `export` statement suitable for sourcing:

```sh
$ eval $(e gh-auth --shell)
```

The token is read from the `ELECTRON_BUILD_TOOLS_GH_AUTH` environment variable.

### `e auto-update`

Manage build-tools' own updates. Alias: `e check-for-updates`.

| Subcommand              | Description                                                                 |
|:------------------------|:----------------------------------------------------------------------------|
| `e auto-update`         | Check for updates and apply them immediately                                |
| `e auto-update check`   | Same as above                                                               |
| `e auto-update enable`  | Enable the 4-hour background update check                                   |
| `e auto-update disable` | Disable the background update check                                         |

With the default configuration, build-tools automatically checks for updates every 4 hours.
Auto-update is skipped entirely if `BUILD_TOOLS_SHA` is set (i.e. you've checked out a specific
commit for debugging).

## Configuration file reference

Build configs live in `configs/` as JSON or YAML files named `evm.<name>.<json|yml|yaml>`. The
currently-active config is tracked in `configs/evm-current.txt` (or `EVM_CURRENT_FILE` — see
[Advanced](#per-session-active-configs)). The full schema is declared in
[`evm-config.schema.json`](./evm-config.schema.json) and validated on every load.

See [`example-configs/`](./example-configs/) for annotated templates (`evm.base.yml`,
`evm.testing.yml`, `evm.release.yml`, `evm.chromium.yml`).

**Top-level fields**

| Field                   | Type                                  | Description                                                                          |
|:------------------------|:--------------------------------------|:-------------------------------------------------------------------------------------|
| `root`                  | string                                | Top directory — home of `.gclient`                                                   |
| `remotes.electron.origin` | string                              | Origin git URL for `electron/electron` (ssh or https)                                |
| `remotes.electron.fork` | string (optional)                     | Optional fork remote URL                                                             |
| `gen.args`              | string[]                              | GN arguments written to `out/<name>/args.gn`                                         |
| `gen.out`               | string                                | Output directory name (e.g. `Testing`)                                               |
| `env.GIT_CACHE_PATH`    | string (optional)                     | Git cache path for gclient (shared across configs)                                   |
| `env.*`                 | string                                | Any additional env vars to inject into build-tools' subprocesses                     |
| `defaultTarget`         | string (default: `electron`)          | Default ninja target for `e build`                                                   |
| `execName`              | string (default: `Electron`)          | Name of the built executable for `e start`                                           |
| `remoteBuild`           | `siso` \| `reclient` \| `none`        | Which remote-execution backend to use                                                |
| `rbeHelperPath`         | string (optional)                     | Path to a custom RBE credential helper                                               |
| `rbeServiceAddress`     | string (optional)                     | Alternative RBE cluster address                                                      |
| `preserveSDK`           | integer (default: 5)                  | Number of recent macOS SDKs to keep on disk                                          |
| `configValidationLevel` | `strict` \| `warn` \| `none`          | How strictly to validate the config file (default: `strict`)                         |
| `extends`               | string (optional)                     | Name of a base config to inherit from; arrays concatenate and objects deep-merge     |
| `$schema`               | URI                                   | Reference to `evm-config.schema.json` for editor validation                          |

A config must supply **one** of:

1. `extends` (inherit everything from another config), **or**
2. `root` + `remotes` + `gen` + `env` (a full Electron build), **or**
3. `defaultTarget: chrome` + `root` + `env` (a Chromium-only build).

**Config inheritance (`extends`)** — useful for keeping shared fields (git cache path, git remotes) in a base config and deriving per-variant configs from it:

```yaml
# evm.base.yml
root: /Users/me/src/electron
remotes:
  electron:
    origin: git@github.com:electron/electron.git
env:
  GIT_CACHE_PATH: /Users/me/.git_cache

# evm.testing.yml
extends: base
gen:
  args:
    - import("//electron/build/args/testing.gn")
  out: Testing
```

**Preferred format on save** — by default `e init` and `e sanitize-config` write JSON. Set
`EVM_FORMAT=yml` to prefer YAML.

## Environment variables

| Variable                             | Purpose                                                                                             |
|:-------------------------------------|:----------------------------------------------------------------------------------------------------|
| `EVM_CONFIG`                         | Override the configs directory (default: `<build-tools>/configs`)                                   |
| `EVM_CURRENT`                        | Override the active config for the current process (set internally by `--config=<name>`)            |
| `EVM_CURRENT_FILE`                   | Alternative location for the active-config pointer file. Enables per-session active configs.        |
| `EVM_FORMAT`                         | Preferred on-disk format for configs when saving: `json` (default), `yml`, or `yaml`                |
| `BUILD_TOOLS_SHA`                    | If set, skip the auto-update check (useful when you've checked out a specific build-tools commit)   |
| `DEPOT_TOOLS_DIR`                    | Override the depot-tools directory (default: `<build-tools>/.depot_tools`)                          |
| `GIT_CACHE_PATH`                     | Consumed by `e init` as the default for new configs' `env.GIT_CACHE_PATH`                           |
| `GN_EXTRA_ARGS`                      | When `CI=1`, appended to the GN args for `e build` (space-separated `key=value` tokens)             |

## Shell completion

A zsh completion script lives at [`tools/zsh/_e`](./tools/zsh/_e). Source it from your `.zshrc`
(or symlink it into an `fpath` directory) to get completion for subcommands, options, config
names, and build targets.

## Advanced

### Building a specific Electron version

`e init` checks out the HEAD of the main branch. To build against a specific version:

```sh
# change to the Electron source directory
$ cd `e show src`

# check out the desired Electron version (in this case, 11.0.0)
$ git checkout tags/v11.0.0 -b v11.0.0

# sync dependencies with the current branch
$ e sync

# build
$ e build
```

### Per-session active configs

If you want your shell sessions to each have different active configs, try this in your
`~/.profile` / `~/.zshrc` / `~/.bashrc`:

```sh
export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
```

This creates per-shell temporary files in which the active config can be changed with `e use`,
without affecting other shells.

### Disabling automatic updates

Build-tools automatically checks for updates every 4 hours. You can toggle this:

```sh
$ e auto-update enable
$ e auto-update disable
```

Regardless, you can trigger an update immediately with `e auto-update check`.

### Appending GN args in CI

In CI (`CI=1`), `GN_EXTRA_ARGS` is appended to the GN args read from your config. This is a handy
way to override args without editing the config file:

```sh
$ CI=1 GN_EXTRA_ARGS="is_official_build=true" e build
```

[depot-tools]: https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up
[gdb]: https://web.eecs.umich.edu/~sugih/pointers/summary.html
[gn-configs]: https://github.com/electron/electron/tree/main/build/args
[gn]: https://gn.googlesource.com/gn/+/main/docs/reference.md
[lldb]: https://lldb.llvm.org/use/tutorial.html
[ninja]: https://ninja-build.org
[nvm]: https://github.com/nvm-sh/nvm
[platform-prerequisites]: https://electronjs.org/docs/development/build-instructions-gn#platform-prerequisites
[sanitizers]: https://github.com/google/sanitizers
