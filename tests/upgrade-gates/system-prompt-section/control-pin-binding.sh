#!/usr/bin/env bash
# WAVE-D-S01 CONTINUATION P2 negative + positive control for the fail-closed
# pin binding in run-system-prompt-section.sh.
#
# Identical discipline to tests/upgrade-gates/system-prompt-context/
# control-pin-binding.sh, bound to the systemPrompt.section fallback gate.
#
# The mirror layout reproduces the CI gate shape: a "plugin repository root"
# holds package.json and the run script lives at
# <root>/tests/upgrade-gates/system-prompt-section/. The script under test is
# copied from the live tree at run time, so this control exercises the exact
# current artifact.
#
#   NEGATIVE: repository DSH pins diverge from the probe expected package line
#             (fixture 0.1.2-rc.1 vs probe 0.1.1-rc.2) -> gate exits non-zero
#             with PLUGIN_REPO_DSH_PIN_MISMATCH BEFORE the behavior probe runs.
#   POSITIVE: current repository pins (0.1.1-rc.2) -> the pin preflight passes
#             and the gate advances past it to the pinned-checkout checks.
#
# Run with any POSIX bash; needs only `node` on PATH (no vitest, no DSH tree).
set -euo pipefail
# The host safe-delete shim must not interfere with disposable temp trees.
export CODEBUDDY_SAFE_DELETE_ENABLED=0

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
run_script="$script_dir/run-system-prompt-section.sh"
real_manifest="$script_dir/../../../package.json"
expected_version=0.1.1-rc.2
divergent_version=0.1.2-rc.1

work=$(mktemp -d)
trap '/usr/bin/rm -rf "$work"' EXIT

mirror="$work/repo"
mkdir -p "$mirror/tests/upgrade-gates/system-prompt-section" "$work/dsh-stub"

rewrite_pins() {
  local file="$1" version="$2" dir
  dir=$(cd "$(dirname "$file")" && pwd)
  (cd "$dir" && node --input-type=module - "$(basename "$file")" "$version" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const [file, version] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(file, 'utf8'))
for (const section of ['peerDependencies', 'devDependencies']) {
  for (const pkg of ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session']) {
    if (manifest[section]?.[pkg]) manifest[section][pkg] = version
  }
}
writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
NODE
)
}

run_gate() {
  # shellcheck disable=SC2086
  (cd "$mirror" && DSH_PINNED_ROOT="$work/dsh-stub" bash "$mirror/tests/upgrade-gates/system-prompt-section/run-system-prompt-section.sh" >"$1" 2>"$2")
  echo $?
}

cp "$run_script" "$mirror/tests/upgrade-gates/system-prompt-section/run-system-prompt-section.sh"

# ---------------------------------------------------------------- NEGATIVE
cp "$real_manifest" "$mirror/package.json"
rewrite_pins "$mirror/package.json" "$divergent_version"
set +e
neg_code=$(run_gate "$work/neg.out" "$work/neg.err")
set -e

neg_fail=0
[[ "$neg_code" != "0" ]] || { echo "NEGATIVE FAIL: gate exited 0 on divergent pins" >&2; neg_fail=1; }
grep -q "PLUGIN_REPO_DSH_PIN_MISMATCH" "$work/neg.err" || { echo "NEGATIVE FAIL: no PLUGIN_REPO_DSH_PIN_MISMATCH diagnostic" >&2; neg_fail=1; }
grep -q "peerDependencies.@deepseek-ai/dsh-agent: expected ${expected_version}, received ${divergent_version}" "$work/neg.err" || { echo "NEGATIVE FAIL: missing per-pin mismatch line" >&2; neg_fail=1; }
if grep -qi "vitest\|DSH_SPIKE_TRACE" "$work/neg.out" "$work/neg.err"; then
  echo "NEGATIVE FAIL: behavior probe output present before pin failure" >&2
  neg_fail=1
fi
if [[ "$neg_fail" != "0" ]]; then
  echo "--- neg.out ---" >&2; cat "$work/neg.out" >&2 || true
  echo "--- neg.err ---" >&2; cat "$work/neg.err" >&2 || true
  exit 1
fi
echo "NEGATIVE PASS: divergent pins (${divergent_version}) -> exit ${neg_code}, RED before probe"
grep "PLUGIN_REPO_DSH_PIN_MISMATCH" "$work/neg.err"

# ---------------------------------------------------------------- POSITIVE
cp "$real_manifest" "$mirror/package.json"
set +e
pos_code=$(run_gate "$work/pos.out" "$work/pos.err")
set -e

pos_fail=0
grep -q "plugin peerDependencies.@deepseek-ai/dsh-agent: ${expected_version}" "$work/pos.out" || { echo "POSITIVE FAIL: peer pin line missing" >&2; pos_fail=1; }
grep -q "plugin devDependencies.@deepseek-ai/dsh-session: ${expected_version}" "$work/pos.out" || { echo "POSITIVE FAIL: dev pin line missing" >&2; pos_fail=1; }
if grep -q "PLUGIN_REPO_DSH_PIN_MISMATCH" "$work/pos.out" "$work/pos.err"; then
  echo "POSITIVE FAIL: pin mismatch reported on matching pins" >&2; pos_fail=1
fi
# The stub DSH root is not a git repository, so the gate must advance PAST the
# pin preflight and fail on the pinned-checkout check instead.
grep -qi "not a git repository\|does not appear to be a git repository\|fatal" "$work/pos.err" "$work/pos.out" || { echo "POSITIVE FAIL: gate did not advance past the pin preflight to checkout checks" >&2; pos_fail=1; }
if [[ "$pos_fail" != "0" ]]; then
  echo "--- pos.out ---" >&2; cat "$work/pos.out" >&2 || true
  echo "--- pos.err ---" >&2; cat "$work/pos.err" >&2 || true
  exit 1
fi
echo "POSITIVE PASS: current pins (${expected_version}) pass the preflight and advance to checkout checks (exit ${pos_code})"
grep "plugin " "$work/pos.out"

echo "CONTROL-PIN-BINDING-SECTION: ALL PASS"
