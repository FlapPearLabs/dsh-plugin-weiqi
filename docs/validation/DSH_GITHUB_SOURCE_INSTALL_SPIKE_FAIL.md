# DSH GITHUB SOURCE INSTALL SPIKE — FAIL RECORD

## Final Result

```text
FAIL — GITHUB_SOURCE_INSTALL_NOT_ACTIVATING
```

`dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` resolves,
clones, installs the package, and reconciles the Profile Bundle list on the
pinned DeepSeek Harness. Activation fails: the installed package has no build
output, so the Loader cannot import `lib/index.js`.

Ticket: `INFRA-S01` (Baseline `BL-PKG-06`). No publish config, install code, or
production source was changed by this Spike.

## Pinned Environment

Executed in a disposable `$DSH_HOME`; the DSH checkout is the pinned commit and
sits outside the plugin repository.

```text
commit=b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
node=v24.11.1
pnpm=11.7.0
package.json: @deepseek-ai/dsh-root@0.1.1-rc.2
packages/core/agent/package.json: @deepseek-ai/dsh-agent@0.1.1-rc.2
packages/core/agent-loop/package.json: @deepseek-ai/dsh-agent-loop@0.1.1-rc.2
packages/core/session/package.json: @deepseek-ai/dsh-session@0.1.1-rc.2
packages/llm/llm/package.json: @deepseek-ai/dsh-llm@0.1.1-rc.2
apps/cli/package.json: @deepseek-ai/dsh@0.1.1-rc.2
```

- DSH source: `git init` + `git fetch --depth 1 origin b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
  + `git checkout FETCH_HEAD`; `git rev-parse HEAD` returned the pinned commit.
- Dependencies: `pnpm install --frozen-lockfile` (resumed after one registry
  timeout; final run exit `0`).
- CLI build: `pnpm run build:lib:host` (exit `0`); entry
  `apps/cli/lib/bin.js` and `packages/boot/app-boot/lib/index.js` exist.
- Plugin package pinned at `0.0.0-foundation.1` (repository `HEAD` of the
  `github:` spec, see "Resolution is unpinned" below).

## Executed Command

```text
$ DSH_HOME=<fresh dir> node apps/cli/lib/bin.js plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi
PLUGIN_ADD_EXIT=0
```

Full stdout/stderr:

```text
dsh: initialized profile web at <fresh DSH_HOME>/profiles/web
Packages are cloned from the content-addressable store to the virtual store.
  Content-addressable store is at: ~/Library/pnpm/store/v11
  Virtual store is at:             node_modules/.pnpm
Progress: resolved 0, reused 0, downloaded 1, added 0
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.

dependencies:
+ @flappearlabs/dsh-plugin-weiqi github:FlapPearLabs/dsh-plugin-weiqi

Packages: +1
+
Progress: resolved 1, reused 0, downloaded 1, added 1, done
Done in 11.1s using pnpm v11.7.0
```

## Observed Stages

| Stage | Observed | Evidence |
|---|---|---|
| Resolution | YES — `github:FlapPearLabs/dsh-plugin-weiqi` accepted and resolved to a codeload tarball of one commit | profile `pnpm-lock.yaml` resolution entry |
| Clone / fetch | YES — pnpm fetched the git source from GitHub and packed it | `Packages: +1`, installed tree |
| Build | NO — no build ran; the installed package has no `lib/` | installed tree (3 files only) |
| Install | YES — dependency added to the profile manifest | profile `package.json` |
| Bundle reconciliation | YES — package joined `dsh.profile.bundles`, composition contains the row | profile `package.json`, `--dump-config` |
| Activation | NO — Loader fails to import `lib/index.js` | mount-smoke error below |

### Bundle reconciliation (observed)

Profile manifest after the run:

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@flappearlabs/dsh-plugin-weiqi": "github:FlapPearLabs/dsh-plugin-weiqi"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@flappearlabs/dsh-plugin-weiqi"
      ]
    }
  }
}
```

`dsh --profile web --dump-config` (exit `0`) composes the bundle row:

```text
504:# == @flappearlabs/dsh-plugin-weiqi
505:- id: companion-go
506:  name: '@flappearlabs/dsh-plugin-weiqi'
```

### Installed package contents (observed)

```text
profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi
profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi/cordis.patch.yml
profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi/README.md
profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi/package.json
```

No `lib/`, no `src/`. The installed manifest is the repository manifest
(`main: lib/index.js`, `dsh.bundle.patch: ./cordis.patch.yml`, scripts
`build`/`clean`/`test`/`typecheck`/`verify`, no `prepare`).

## Activation Attempt (reused `tests/profile-install/profile-mount-smoke.mjs`)

Command:

```text
$ DSH_SOURCE_DIR=<pinned DSH> DSH_HOME=<fresh DSH_HOME> DSH_PROFILE_NAME=web \
  DSH_PROFILE_DUMP=<dump-config output> \
  node tests/profile-install/profile-mount-smoke.mjs
MOUNT_SMOKE_EXIT=1
```

Assertions that passed before the mount step:

```text
TRACE profile dependency=@flappearlabs/dsh-plugin-weiqi
TRACE profile bundles=@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,@flappearlabs/dsh-plugin-weiqi
TRACE bundle layer patch=<fresh DSH_HOME>/profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi/cordis.patch.yml
TRACE profile composition contains bundle marker and Companion Go row
```

Exact failure (abridged to the causal chain; the full stack is in the trace):

```text
Error: companion-go-profile-smoke: plugin tree failed to load: failed to apply
loader entry include (cordis:include): failed to import loader entry companion-go
(@flappearlabs/dsh-plugin-weiqi): Cannot find module
'<fresh DSH_HOME>/profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi/lib/index.js'
imported from <fresh DSH_HOME>/profiles/web/

Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'<fresh DSH_HOME>/profiles/web/node_modules/@flappearlabs/dsh-plugin-weiqi/lib/index.js'
```

The Loader row, the bundle patch layer, and the composition all resolve; only
the module import fails.

## Root Cause (evidence-backed)

1. The repository tracks no build output: `git ls-files lib` returns `0`
   entries, and `.gitignore` ignores `lib/`.
2. `package.json` declares no `prepare` / `prepublishOnly` script, so installing
   from a git source performs no build step.
3. `package.json` `files` ships only `cordis.patch.yml` and `lib/**/*.js`
   (plus `lib/**/*.d.ts`), so the packed git source contains no sources either
   — exactly the three installed files above.
4. `main` is `lib/index.js`, which therefore never exists.

Pinned DSH documents this exact contract for git-hosted plugins
(`apps/cli/reference/README.md`, "Plugin management"):

```text
Git-hosted plugins that ship sources build during install through their `prepare`
script, which pnpm ≥10 blocks until the consumer allows it: the first `add` fails
with pnpm's `allowBuilds` hint (and a dsh pointer at the profile's
`pnpm-workspace.yaml`); copy the printed key there and re-run. Installing a built
tarball or a local checkout needs no allowance.
```

This package declares no `prepare` script at all, so no `allowBuilds` entry can
produce `lib/`; the observed install succeeded because nothing was blocked, and
activation failed because nothing was built.

## Observed Side Facts

### Resolution is unpinned

`github:FlapPearLabs/dsh-plugin-weiqi` resolved to the repository's default-branch
`HEAD` at run time, recorded in the profile lockfile as:

```text
version: https://codeload.github.com/FlapPearLabs/dsh-plugin-weiqi/tar.gz/82552a48566ca52a5eb573f498e5bb5a32e19428
```

`82552a4` was `origin/main` / `origin/HEAD` in this repository at the time of the
run (`Merge pull request #77 from FlapPearLabs/docs/b-t01-post-merge-sync`). The
`github:` form without a ref installs whatever the default branch points at.

### The forwarded pnpm is the ambient one

`dsh plugin` spawns `pnpm` from `PATH` in the profile directory. The profile
manifest carries no `packageManager` field, so the ambient binary decides its own
version: the first run (Homebrew `pnpm` on `PATH`) executed with `pnpm v10.33.0`,
the confirming run with a `pnpm 11.7.0` binary first on `PATH`. Both runs
behaved identically — exit `0` for `add`, identical installed tree, identical
mount-smoke failure.

## Fallback

Installation stays on the packed tarball path already verified by
`BL-PKG-05` (`tests/profile-install/run-profile-install-smoke.sh`: `pnpm pack`
→ `dsh plugin --profile <name> add <tarball>` → bundle reconciliation → mounted
fiber), until the GitHub-source path gains a real build step.

## Baseline Proposal

`BL-PKG-06` must not advance to `IMPLEMENTED_VERIFIED`. Proposed row:

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-PKG-06 | GitHub source install | `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` builds and activates | `dsh plugin --profile web add github:...` on pinned DSH resolves/clones/installs and reconciles the bundle, but activation fails with `ERR_MODULE_NOT_FOUND ... lib/index.js`; package has no `prepare` and ships no built output; see `docs/validation/DSH_GITHUB_SOURCE_INSTALL_SPIKE_FAIL.md` | NOT_IMPLEMENTED | git-source install never builds; no `prepare` script and `files` omits sources | — | SMALL_INFRA_TICKET |

The Baseline file itself is synced by the post-merge `docs:` commit, following
the convention of the previous Baseline updates.

## Not Verified

- No `prepare`-script variant was tested (would change packaging behaviour, out
  of this Ticket's scope).
- No `allowBuilds` entry was tested (nothing to allow: no build script exists).
- The full Web profile was not booted (`pnpm run build` of the DSH frontend was
  not run); activation was measured with the repository's own mount smoke over
  the real pinned AgentLoop, which is the assertion the Ticket names.
- Peer warnings (`@deepseek-ai/cordis`, `dsh-agent`, `dsh-llm`, `dsh-session`
  missing in the profile) were observed but not investigated: the mount smoke
  supplies those cores itself and failed only on the missing `lib/index.js`.
- Windows / CI execution: not run; this record is a single local execution on
  `darwin arm64`.

## Reproduction

```sh
# pinned DSH
git init DSH-PINNED && cd DSH-PINNED
git remote add origin https://github.com/deepseek-ai/deepseek-harness.git
git fetch --depth 1 origin b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
git checkout FETCH_HEAD && git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm run build:lib:host

# spike
export DSH_HOME=$(mktemp -d)
node apps/cli/lib/bin.js plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi
node apps/cli/lib/bin.js --profile web --dump-config > dump.yml

# assertions (from the plugin checkout)
DSH_SOURCE_DIR=$PWD/DSH-PINNED DSH_HOME=$DSH_HOME DSH_PROFILE_NAME=web \
  DSH_PROFILE_DUMP=$PWD/dump.yml node tests/profile-install/profile-mount-smoke.mjs
```
