# Pinned Tenuki conformance for the frozen rules contract

Status: **PASS — VERIFIED FACT, NOT PRODUCTION RULES**

Issue: WAVE-B-S01 / #10

Baseline ID: BL-GR-03 (`NEEDS_SPIKE` → `VERIFIED_FACT_NOT_INTEGRATED`)

Pinned candidate: `tenuki@0.3.1`

Integrity (tarball, from the npm registry):
`sha512-4obVv+CHn0QXrtHEZOYXE69xweUAae/iHfEz6oqM+dKTcdL8b0G44knfjLtepu4UHdwW0OzxurXDXoZKzKOIIQ==` /
shasum `8b53cae9641ad83c7d817b1fe8277181d3d742c0`

Integrity (file, asserted by the runner):
`package.json` sha1 `d0cd7c688ccbfed6284df287267241179dae3525`

Source of truth: `https://github.com/aprescott/tenuki` (MIT); npm tarball
`https://registry.npmmirror.com/tenuki/-/tenuki-0.3.1.tgz`.

This spike evaluates one candidate narrowly. It does not implement
`GoRulesPort`, `TenukiAdapter`, the canonical record, or scoring UX, and it does
not add a second superko layer. B-T02 owns the production pin.

## Scope and method

The frozen rules contract (`SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md` §25/§27/§31):

```text
scoring = area
koRule = positional-superko
komi = 7.5
no reliance on library defaults
```

Candidate evaluation: `tenuki@0.3.1` (the current latest dist-tag; earlier
published versions 0.0.7…0.2.2 share the same rules module layout, but only the
latest was evaluated — no broad benchmarking). The library source was inspected
for the configuration surface, then executable evidence was produced against
the real package via the retained spec `tests/upgrade-gates/tenuki-conformance/`.

## Configuration surface (source inspection)

`lib/game.js`:

- `VALID_GAME_OPTIONS` includes `boardSize`, `scoring`, `koRule`, `komi`
  (`lib/game.js:37`).
- Defaults are `scoring = "territory"`, `koRule = "simple"`, `komi = 0`
  (`lib/game.js:51-52`, `:78-87`) — none of the frozen values is a default, so
  explicit configuration is genuinely required and genuinely supported.
- `komi` is passed to the scorer and added to white's score
  (`lib/scorer.js:255-257` `result.white += this._komi`).
- `scoring: "area"` selects `AreaScoring` = territory points + live stones
  (`lib/scorer.js:182-223`), which is Chinese-style area scoring.

`lib/ruleset.js`:

- `VALID_KO_OPTIONS = ["simple", "positional-superko", "situational-superko",
  "natural-situational-superko"]` (`lib/ruleset.js:6`) — the exact string
  `"positional-superko"` required by §27 is a first-class option.
- Positional superko rejects a move whose resulting position equals **any**
  previously recorded position (`lib/ruleset.js:37-48`, `positionSameAs` in
  `lib/board-state.js:293-297`). No second rules authority is involved.

## Executed proof

The retained spec (`tests/upgrade-gates/tenuki-conformance/tenuki-conformance.spec.ts`)
is run by the runner
(`tests/upgrade-gates/tenuki-conformance/run-tenuki-conformance.sh`), which
installs the exact pinned version into a scratch directory, asserts the
installed version, and runs the spec against it. The plugin manifest is not
modified; `TENUKI_ROOT` points at the scratch install (same convention as
`DSH_PINNED_ROOT` in the C-S01 / E-S01 runners).

Run:

```bash
bash tests/upgrade-gates/tenuki-conformance/run-tenuki-conformance.sh
```

The runner asserts Node `v24.11.1` by default (the repo pin); on a machine
with a different Node, set `EXPECTED_NODE` to the actual version (e.g.
`EXPECTED_NODE=v24.19.0`). CI runs the default pin via
`.github/workflows/tenuki-conformance-gate.yml`.

Executed result (Node v24.19.0 local run, `EXPECTED_NODE=v24.19.0`; CI runs the
pinned v24.11.1):

```text
TRACE tenuki pinned=0.3.1 node=v24.19.0
TRACE installed tenuki@0.3.1 shasum=d0cd7c688ccbfed6284df287267241179dae3525
 ✓ tests/upgrade-gates/tenuki-conformance/tenuki-conformance.spec.ts (6 tests)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Conformance results

1. **Exact package/version under test:** PASS — the runner asserts the
   installed `package.json` version equals `0.3.1` AND its sha1 equals the
   pinned `d0cd7c68...` (content pin, not just the semver label); the spec
   independently reads the version from `TENUKI_ROOT`.
2. **Explicit area/scoring configuration:** PASS — `new Game({ scoring: "area",
   ... })` is accepted, and the same endgame scores differently under `area`
   (black 9 = 8 stones + 1 territory) versus the `territory` default (black ≠ 9),
   proving the explicit option is honored, not defaulted.
3. **Explicit komi 7.5 configuration:** PASS — with komi 7.5, white scores
   exactly 7.5; with komi 0, white scores 0; the delta is exactly 7.5 and black
   is untouched (`score().white` 7.5 vs 0, `score().black` 9 in both).
4. **Positional-superko behavior (§31 fixture):** PASS — the §31-relevant
   repetition cycle (tenuki's own test-suite cycle, `test/game-ko-test.js`
   "prevents repeating a previous position") is rejected under
   `positional-superko` (`isIllegalAt` true before the attempt, `playAt` false),
   while the identical cycle under `simple` ko is accepted — proving the
   rejection comes from the positional-superko rule, not some other rule.
5. **No reliance on undocumented defaults:** PASS — defaults are
   `territory`/`simple`/komi 0; all three frozen values must be and are
   explicitly configured; behavior differs from defaults by construction.
6. **Deterministic rerun:** PASS — the conformance spec runs the full fixture
   twice in-process and asserts identical traces, and the runner was executed
   twice locally (both `6 passed (6)` with identical results). Note: the CI
   gate runs the probe once per PR; the in-process double-run is the automated
   determinism check.
7. **No second superko/rules authority layer required:** PASS — positional
   superko is built into the single `tenuki` rules module; the fixture uses only
   `tenuki.Game`. §27's "no second custom superko rules layer" is satisfied.

## Consequences for WAVE-B-T02

- Pin `tenuki@0.3.1` exactly (tarball `sha512-4obV+...`, `package.json` sha1
  `d0cd7c68...`) in the production manifest when `TenukiAdapter` is
  implemented. No auto-upgrade.
- At game creation, the Adapter must explicitly pass
  `{ scoring: "area", koRule: "positional-superko", komi: 7.5 }` — defaults are
  `territory`/`simple`/0 and must not be relied upon.
- The tenuki move surface for the port is `game.playAt(y, x)`, `game.pass()`,
  `game.isIllegalAt(y, x)`, `game.score()`, `game.territory()`; captures and ko
  state are internal to tenuki and must not be serialized (§28).
- Note: tenuki territory-scoring filters single-eye regions as seki; the frozen
  contract uses area scoring, which is unaffected and verified above.
- B-T02 must keep `TenukiAdapter` as the only tenuki-touching module; the
  plugin's `package.json` should not otherwise gain tenuki at the top level.

## Boundary result

- Production adapter implemented: **NO**
- Production pin written: **NO** (B-T02 surface)
- Second superko / rules authority added: **NO**
- Silent downgrade to simple ko: **NO**
- Merge performed: **NO** (PR remains open)
