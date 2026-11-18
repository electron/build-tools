load("@builtin//encoding.star", "json")
load("@builtin//path.star", "path")
load("@builtin//runtime.star", "runtime")
load("@builtin//struct.star", "module")
load("@config//ar.star", "ar")
load("@config//main.star", upstream_init = "init")
load("@config//win_sdk.star", "win_sdk")
load("@config//gn_logs.star", "gn_logs")

# Installed by src/utils/cross-clang.ts, next to the Linux clang it runs.
cross_clang_wrapper = "buildtools/reclient_cfgs/chromium-browser-clang/clang_remote_wrapper"
linux_clang = "third_party/llvm-build/Release+Asserts_linux/bin/clang"

# Opt out of everything in _electron_extras() with `e build -config=electron-no-extras`
# (it combines with Chromium's own -config values: -config=remote-link,electron-no-extras).
ELECTRON_NO_EXTRAS = "electron-no-extras"

# Chromium rules that Chromium only runs remotely under its "googlechrome" /
# "default-remote" configs, which Electron's backend doesn't set. Each was run
# remotely on Electron's RBE and its outputs compared with a local build.
# Link steps (rust_bin, rust_cdylib, rust_macro, clang links) stay local:
# electron-rbe has no remote-link support. rust/bindgen stays local because it
# fails remotely.
_ELECTRON_REMOTE_RULES = {
    # Rust
    "rust_rlib": {},
    "rust_staticlib": {},
    "rust/run_build_script": {},
    "rust/find_std_rlibs": {},
    "rust/cpp_api_from_rust": {},
    "rust/rust_api_from_cpp": {},
    # Chromium lists this one in denylist.star; it only needs the two helper
    # modules it imports declared as inputs.
    "third_party/rust/cxx/chromium_integration/run_cxxbridge.py": {
        "inputs": ["build/action_helpers.py", "build/gn_helpers.py"],
    },
    # Assembly and code generators
    "nasm": {},
    "nasm/clang_x64": {},
    "proto/protoc_wrapper": {},
    "v8/torque": {},
    "blink/run_with_pythonpath": {},
    "blink/build_web_idl_database": {},
    "typescript/ts_definitions": {"handler": "typescript_ts_definitions"},
    # DevTools frontend
    "devtools-frontend/build/generate_css_js_files": {},
    "devtools-frontend/build/optimize_images": {},
    # esbuild reads the tsconfig.json ("extends" chain included) and
    # package.json files above each source file, and with --sourcemap it
    # follows the //# sourceMappingURL of bundled third_party .js files. None
    # of those are GN inputs, so without them a remote esbuild silently
    # produces different bundles (iife bundles lose "use strict"). These
    # declarations belong upstream in devtools-frontend (as GN inputs of the
    # esbuild action and a <outfile>.map output); until then, declare them here.
    "devtools-frontend/esbuild": {
        "inputs": [
            "third_party/devtools-frontend/src/front_end:esbuild_configs",
            "third_party/devtools-frontend/src/inspector_overlay/tsconfig.json",
            "third_party/devtools-frontend/src/scripts/tsconfig.json",
            "third_party/devtools-frontend/src/scripts/package.json",
            "third_party/devtools-frontend/src/config/typescript/tsconfig.base.json",
            "third_party/devtools-frontend/src/package.json",
            # Read by the source-map-scopes-codec bundle (package/src/*.js;
            # without them esbuild falls back to the sibling .ts sources) and
            # by lighthouse (report-generator.mjs from the source tree).
            "third_party/devtools-frontend/src/front_end/third_party/source-map-scopes-codec/package/src:js",
            "third_party/devtools-frontend/src/front_end/third_party/lighthouse/report-assets/report-generator.mjs",
            "third_party/devtools-frontend/src/front_end/third_party:sourcemaps",
        ],
        "handler": "electron_esbuild_sourcemap",
    },
}

# Python scripts that have no Chromium siso rule and run remotely here. Each
# was read and found hermetic (it reads only its declared inputs and its own
# imports; no git, network, environment, absolute paths or clock beyond the
# copyright year) and then compared with a local build. There is no catch-all:
# Chromium's "default-python" rule breaks several scripts that read git
# (third_party/angle/src/commit_id.py writes "unknown hash" remotely) or paths
# outside their inputs, so anything not listed stays local.
_ELECTRON_REMOTE_PYTHON = {
    # script (and leading args): extra rule fields
    "tools/json_schema_compiler/compiler.py": {},
    "tools/grit/pak_util.py repack": {},
    "tools/grit/preprocess_if_expr.py": {},
    "net/tools/dafsa/make_dafsa.py": {},
    "third_party/blink/renderer/bindings/scripts/generate_event_interface_names.py": {},
    "third_party/blink/renderer/bindings/scripts/check_generated_file_list.py": {},
    "third_party/blink/renderer/bindings/scripts/collect_idl_files.py": {},
    "third_party/blink/renderer/bindings/scripts/validate_web_idl.py": {},
    "third_party/blink/renderer/build/scripts/run_with_pythonpath.py": {},
    # Writes its args as JSON. v8's metagen.py waits for it at the start of
    # the build, where it would otherwise queue for a local slot.
    "v8/tools/testrunner/utils/dump_build_config.py": {},
}

# devtools-frontend wraps both python generators and TypeScript steps in these
# scripts, so match on GN action names as well: the CSS properties generator,
# and the *-dts (isolated declarations), *_checked (chromium-bidi) and
# *_typecheck (tsc -p, noEmit) steps. tsc here is tsgo, a static linux-amd64
# binary whose lib/*.d.ts are already GN inputs.
_ELECTRON_REMOTE_DEVTOOLS_WRAPPED = [
    ("generate_supported_css", "run_with_restat", ".*_generate_supported_css_properties___.*"),
    ("tsc/run_with_restat", "run_with_restat", ".*(-dts|_checked|_typecheck)___.*"),
    ("tsc/run_with_stamp", "run_with_stamp", ".*(-dts|_checked|_typecheck)___.*"),
]

_PYTHON = "../../third_party/cpython3/host/bin/python3"
_REMOTE_PYTHON = "../../third_party/cpython3/linux-amd64/bin/python3"
_REMOTE_PYTHON_INPUTS = "third_party/cpython3/linux-amd64:cpython3"

def _esbuild_sourcemap(ctx, cmd):
    # esbuild --sourcemap also writes <outfile>.map, which is not a GN output,
    # so a remote step wouldn't download it. Declare it (belongs upstream in
    # devtools-frontend's esbuild GN template).
    if "--sourcemap" not in cmd.args:
        return
    for i, a in enumerate(cmd.args):
        if a == "--outfile" and i + 1 < len(cmd.args):
            m = ctx.fs.canonpath(cmd.args[i + 1] + ".map")
            if m not in cmd.outputs:
                ctx.actions.fix(outputs = cmd.outputs + [m])
            return

def _thin_archive(ctx, cmd):
    # Chromium's lld_thin_archive handler (build/config/siso/clang_all.star)
    # without its remote-link gate: siso writes the thin archive without symbol
    # table (llvm-ar -T -S) itself instead of running llvm-ar. The step then
    # needs neither its accumulated inputs (15-23k objects for some Blink
    # archives) expanded and flushed to disk nor a local process. The output is
    # byte-identical to llvm-ar's. Chromium's version mishandles empty
    # archives and empty rsp tokens; both are handled here. Drop this (and
    # the handler override in _electron_extras) once Chromium ungates
    # lld_thin_archive for llvm-ar and fixes those two cases upstream.
    if not ("-T" in cmd.args[-1] and "-S" in cmd.args[-1]):
        return
    inputs = []
    for line in str(cmd.rspfile_content).split("\n"):
        for fname in line.split(" "):
            if fname:
                inputs.append(ctx.fs.canonpath(fname))
    if not inputs:
        # llvm-ar writes only the magic for an empty thin archive.
        data = bytes("!<thin>\n")
    else:
        data = ar.create(ctx, path.dir(cmd.outputs[0]), inputs)
    ctx.actions.write(cmd.outputs[0], data)
    ctx.actions.exit(exit_status = 0)

def _electron_extras_enabled(ctx, filegroups):
    configs = ctx.flags["config"].split(",") if "config" in ctx.flags else []
    if ELECTRON_NO_EXTRAS in configs:
        return False

    # Verified on Linux x64 hosts only. Also requires the DEPS-provided Linux
    # python (crrev.com/c/8160801); older branches keep the previous behavior.
    return runtime.os == "linux" and _REMOTE_PYTHON_INPUTS in filegroups

def _electron_extras(step_config, filegroups):
    """Remote execution and siso-side steps beyond Chromium's defaults.

    All of it was verified on a clean, warm-cache Linux build by comparing the
    sha256 of every build output (~149k files) with a fully local build: no
    differences other than files that already differ between two local builds.
    """
    for rule in step_config["rules"]:
        name = rule["name"]
        if name in _ELECTRON_REMOTE_RULES:
            extra = _ELECTRON_REMOTE_RULES[name]
            rule["remote"] = True
            rule["timeout"] = "10m"
            if "inputs" in extra:
                rule.setdefault("inputs", []).extend(extra["inputs"])
            if "handler" in extra:
                rule["handler"] = extra["handler"]
            if rule.get("command_prefix", "").startswith(_PYTHON):
                rule["remote_command"] = _REMOTE_PYTHON
                inputs = rule.setdefault("inputs", [])
                if _REMOTE_PYTHON_INPUTS not in inputs:
                    inputs.append(_REMOTE_PYTHON_INPUTS)
        elif name == "clang/alink/llvm-ar":
            rule["handler"] = "electron_thin_archive"

    # Appended, so these only match steps that no Chromium rule claimed.
    remote_py = {
        "remote": True,
        "remote_command": _REMOTE_PYTHON,
        "timeout": "10m",
    }
    for script, extra in _ELECTRON_REMOTE_PYTHON.items():
        rule = {
            "name": "electron/remote-python/" + script.split(" ")[0],
            "command_prefix": _PYTHON + " ../../" + script,
            "inputs": [_REMOTE_PYTHON_INPUTS],
        }
        rule.update(remote_py)
        rule.update(extra)
        step_config["rules"].append(rule)
    for name, wrapper, action in _ELECTRON_REMOTE_DEVTOOLS_WRAPPED:
        rule = {
            "name": "electron/devtools-frontend/" + name,
            "action": action,
            "command_prefix": _PYTHON + " ../../third_party/devtools-frontend/src/scripts/build/" + wrapper + ".py",
            "inputs": [_REMOTE_PYTHON_INPUTS],
        }
        rule.update(remote_py)
        step_config["rules"].append(rule)

    dt = "third_party/devtools-frontend/src/"
    filegroups[dt + "front_end/third_party/source-map-scopes-codec/package/src:js"] = {
        "type": "glob",
        "includes": ["*.js"],
    }
    filegroups[dt + "front_end/third_party:sourcemaps"] = {
        "type": "glob",
        "includes": ["*.map", "*.ts"],
    }
    filegroups[dt + "front_end:esbuild_configs"] = {
        "type": "glob",
        "includes": ["tsconfig*.json", "package.json"],
    }

# Chromium's clang compile rules. clang-coverage/* match the same compiles when
# coverage_instrumentation_input_file wraps them in clang_code_coverage_wrapper.py
# (its handler strips the wrapper so they run clang directly, like clang/*).
def is_clang_rule(rule):
  name = rule["name"]
  return name.startswith("clang/") or name.startswith("clang-coverage/") or name.startswith("clang-cl/")

def init(ctx):
    mod = upstream_init(ctx)
    step_config = json.decode(mod.step_config)

    # Buildbarn doesn't support input_root_absolute_path so disable that
    for rule in step_config["rules"]:    
      input_root_absolute_path = rule.get("input_root_absolute_path", False)
      if input_root_absolute_path:
        rule.pop("input_root_absolute_path", None)

    # The RBE workers are Linux, so on macOS and Windows hosts run the clang
    # steps through a wrapper that swaps in a Linux clang on the worker.
    if runtime.os != "linux":
      for rule in step_config["rules"]:
        if is_clang_rule(rule):
          rule["remote_wrapper"] = "../../" + cross_clang_wrapper
          rule.setdefault("inputs", []).extend([cross_clang_wrapper, linux_clang])
      step_config.setdefault("executables", []).extend([cross_clang_wrapper, linux_clang])

    if runtime.os == "darwin":
      # Chromium took these platforms from the stub rewrapper cfg; use the backend default.
      step_config["platforms"].update({
          "clang": step_config["platforms"]["default"],
          "clang_large": step_config["platforms"]["default"],          
      })      

    # Chromium's clang and clang-cl rules carry a 2 minute timeout that siso
    # applies client-side to the whole remote step (upload + RBE queue +
    # execution + download). When it fires siso re-runs the compile locally,
    # which lands on the critical path: a local ThinLTO compile takes 5-10
    # minutes on the macOS CI runners (75 such fallbacks in one release
    # build), and since local results are not cached, a few heavy Windows
    # clang-cl compiles (e.g. desktop_window_tree_host_win.obj) rerun locally
    # on every warm build. Give remote compiles a deadline that survives RBE
    # queueing; local fallback stays as the safety net.
    if runtime.os != "linux":
      for rule in step_config["rules"]:
        if is_clang_rule(rule) and rule.get("remote"):
          rule["timeout"] = "10m"

    # Add additional Windows SDK headers needed by Electron. Use
    # win_sdk.enabled() (target_os == "win") rather than runtime.os so this
    # also applies when cross-compiling Windows on a Linux host.
    if win_sdk.enabled(ctx):
      win_toolchain_dir = win_sdk.toolchain_dir(ctx)
      sdk_version = gn_logs.read(ctx).get("windows_sdk_version")
      if win_toolchain_dir and sdk_version and (win_toolchain_dir + ":headers") in step_config["input_deps"]:
        step_config["input_deps"][win_toolchain_dir + ":headers"].extend([
          # third_party/electron_node/deps/uv/include/uv/win.h includes mswsock.h
          path.join(win_toolchain_dir, "Windows Kits/10/Include", sdk_version, "um/mswsock.h"),
          # third_party/electron_node/src/debug_utils.cc includes lm.h
          path.join(win_toolchain_dir, "Windows Kits/10/Include", sdk_version, "um/Lm.h"),
        ])

    if runtime.os == "windows":
      # Chromium took these platforms from the stub rewrapper cfg; use the backend default.
      step_config["platforms"].update({
          "clang-cl": step_config["platforms"]["default"],
          "clang-cl_large": step_config["platforms"]["default"],
          "lld-link": step_config["platforms"]["default"],
      })

    # Chromium gates remote execution of its python/node code generators
    # (mojom, Blink bindings, grit strings, TypeScript/WebUI) on its
    # "googlechrome" config; on Electron's RBE they run fine as-is (Linux
    # workers with python3/node, all inputs checked in), so enable them for
    # every host. Each of these was validated on rbe.notgoma.com: it executes
    # remotely, produces byte-identical outputs and cache-hits on rerun.
    # Besides taking ~1 CPU-hour of python off the 5-core macOS runners per
    # build, remote steps are cached, so unchanged generators become cache
    # hits on every host instead of running locally each time.
    #
    # The typescript/webui rules need their Starlark handlers (which add the
    # node_modules etc. inputs); Chromium only attaches them when remote is
    # enabled at config time, so attach them here.
    #
    # remote_command stays as Chromium set it. Since crrev.com/c/8160801 that
    # is the Linux python3 in third_party/cpython3, which Chromium also adds to
    # each rule's inputs, so the workers don't need a python3 of their own. On
    # older branches it is plain "python3".
    remote_generators = {
        "mojo/mojom_bindings_generator": None,
        "mojo/mojom_parser": None,
        "mojo/generate_type_mappings": None,
        "blink/generate_bindings": None,
        "grit/chrome_app_generated_resources": None,
        "grit/components_strings": None,
        "typescript/ts_library": "typescript_ts_library",
        "webui/minify_js": None,
        "webui/stylelint": None,
        "webui/eslint_ts": "webui_eslint_ts",
    }
    for rule in step_config["rules"]:
      if rule["name"] in remote_generators:
        rule["remote"] = True
        # The grit rules set no timeout. siso then asks for a 2 hour action
        # timeout, which is more than some backends accept.
        rule.setdefault("timeout", "10m")
        handler = remote_generators[rule["name"]]
        if handler:
          rule["handler"] = handler

    # clang-tidy build steps from electron/script/gen-clang-tidy-ninja.py. They
    # are shaped like compiles so scandeps finds their inputs, and are cached
    # and executed remotely like compiles.
    tidy_wrapper = "electron/build/run-clang-tidy-action.sh"
    tidy_rule = {
        "name": "electron/clang-tidy",
        "action": "clang_tidy",
        "command_prefix": "../../" + tidy_wrapper + " ",
        "inputs": [
            tidy_wrapper,
            "third_party/llvm-build/Release+Asserts/bin/clang-tidy",
            ".clang-tidy",
            "electron/.clang-tidy",
            # clang-tidy also reads any .clang-tidy between a source file and
            # electron/, so those go to the worker and into the cache key too.
            "electron/shell:clang_tidy_configs",
        ],
        "exclude_input_patterns": ["*.stamp"],
        "remote": True,
        "timeout": "10m",
    }
    step_config["input_deps"][tidy_rule["inputs"][1]] = step_config["input_deps"].get(
        "third_party/llvm-build/Release+Asserts/bin/clang++", [])
    step_config.setdefault("executables", [])
    step_config["executables"].extend(tidy_rule["inputs"][:2])
    if runtime.os != "linux":
      # Same arrangement as the clang rules above: the RBE workers are Linux, so
      # run through clang_remote_wrapper with the Linux toolchain staged next to
      # the host one. The clang-tidy job downloads the Linux clang-tidy there.
      linux_tools = [
          cross_clang_wrapper,
          linux_clang,
          "third_party/llvm-build/Release+Asserts_linux/bin/clang-tidy",
      ]
      tidy_rule["remote_wrapper"] = "../../" + linux_tools[0]
      tidy_rule["inputs"].extend(linux_tools)
      step_config["executables"].extend(linux_tools)
    step_config["rules"].insert(0, tidy_rule)

    filegroups = dict(mod.filegroups)
    if _electron_extras_enabled(ctx, filegroups):
      _electron_extras(step_config, filegroups)
    # siso uploads this filegroup as a precomputed subtree and drops other
    # inputs under it, including the clang-tidy input of the rule above.
    # Chromium narrowed its bin/clang-* glob in crrev.com/c/8471431, so add
    # clang-tidy back.
    llvm_headers = "third_party/llvm-build/Release+Asserts:headers"
    if llvm_headers in filegroups:
      filegroups[llvm_headers] = dict(filegroups[llvm_headers])
      filegroups[llvm_headers]["includes"] = filegroups[llvm_headers]["includes"] + ["bin/clang-tidy"]
    filegroups["electron/shell:clang_tidy_configs"] = {
        "type": "glob",
        "includes": [".clang-tidy"],
    }

    handlers = dict(mod.handlers)
    handlers["electron_esbuild_sourcemap"] = _esbuild_sourcemap
    handlers["electron_thin_archive"] = _thin_archive

    return module(
      "config",
      step_config = json.encode(step_config),
      filegroups = filegroups,
      handlers = handlers,
    )
