#!/usr/bin/env bash
set -uo pipefail

# Falsifiability check for the hybrid delivery gate: each mutant breaks one
# property the fixture claims, so the matching assertion must go red.
# Mutants live only in the pinned test directory and are removed on exit.
#
# Exit codes: 0 = every mutant was killed (tests failed); 1 = a mutant
# survived (tests passed), so the fixture does not prove that property;
# 2 = setup/infrastructure problem, results untrustworthy.

if [[ -z "${DSH_PINNED_ROOT:-}" ]]; then
  echo "DSH_PINNED_ROOT must point to the pinned deepseek-harness checkout" >&2
  exit 2
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_root=$(cd "$script_dir/../../.." && pwd)
dsh_root=$(cd "$DSH_PINNED_ROOT" && pwd)
tests_dir="$dsh_root/packages/core/agent-loop/tests"
log_dir="${LOG_DIR:-$(mktemp -d)}"
mkdir -p "$log_dir"

section_block='  targets.go.variable(GO_SNAPSHOT_VARIABLE, () => {
    const snapshot = awareness.forGoLane().latestWorkSnapshot
    return snapshot === undefined ? undefined : renderWorkSnapshot(snapshot)
  })
  targets.go.section({
    name: GO_SNAPSHOT_SECTION,
    order: GO_SNAPSHOT_ORDER,
    text: () => (awareness.forGoLane().latestWorkSnapshot === undefined ? '"''"' : `{{${GO_SNAPSHOT_VARIABLE}}}`),
  })
'

context_block='  targets.go.context({
    name: GO_SNAPSHOT_SECTION,
    order: GO_SNAPSHOT_ORDER,
    text: () => {
      const snapshot = awareness.forGoLane().latestWorkSnapshot
      return snapshot === undefined ? '"''"' : renderWorkSnapshot(snapshot)
    },
  })
'

survived=0
run_mutant() {
  local name=$1 replacement=$2
  local dir
  dir=$(mktemp -d "$tests_dir/bridge-delivery-mutant-$name.XXXXXX")
  cp "$script_dir/bridge-delivery.fixture.ts" "$dir/bridge-delivery.spec.ts"
  cp -R "$plugin_root/src" "$dir/plugin"

  if ! node --input-type=module - "$dir/plugin/bridge/delivery.ts" "$section_block" "$replacement" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const [file, from, to] = process.argv.slice(2)
const text = readFileSync(file, 'utf8')
if (!text.includes(from)) {
  console.error('mutant anchor not found in delivery.ts')
  process.exit(4)
}
writeFileSync(file, text.replace(from, to))
NODE
  then
    echo "RESULT: SETUP FAILURE — could not build mutant $name" >&2
    rm -rf "$dir"
    exit 2
  fi

  local log="$log_dir/$name.log"
  ( cd "$dsh_root" && corepack pnpm@11.7.0 exec vitest run --no-file-parallelism --reporter=verbose \
      "packages/core/agent-loop/tests/$(basename "$dir")/bridge-delivery.spec.ts" > "$log" 2>&1 )
  local code=$?
  rm -rf "$dir"

  if [[ $code -eq 0 ]]; then
    echo "mutant $name SURVIVED (fixture stayed green) — see $log"
    survived=$((survived + 1))
  elif grep -q 'AssertionError\|expected' "$log"; then
    echo "mutant $name killed by an assertion — see $log"
    grep -m1 -E 'AssertionError' "$log" | cut -c1-160
  else
    echo "mutant $name produced no real red assertion (compile/import failure) — see $log"
    survived=$((survived + 1))
  fi
}

run_mutant context-seam-for-go "$context_block"
run_mutant no-go-registration ''

if [[ $survived -ne 0 ]]; then
  echo "RESULT: FAIL — $survived mutant(s) survived; the gate does not prove the property"
  exit 1
fi
echo "RESULT: PASS — every mutant was killed by an assertion"
