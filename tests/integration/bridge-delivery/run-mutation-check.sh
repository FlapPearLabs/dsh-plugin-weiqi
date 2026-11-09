#!/usr/bin/env bash
set -uo pipefail

# Falsifiability check for the hybrid delivery gate: each mutant breaks one
# property the fixture claims, so the matching assertion must go red.
# Mutants live only in the pinned test directory and are removed on exit.
#
# Exit codes: 0 = every mutant was killed by a failing test; 1 = a mutant
# survived (it stayed green) or produced no failing test, so the fixture does
# not prove that property; 2 = setup/infrastructure problem, results
# untrustworthy.

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
    text: () =>
      awareness.forGoLane().latestWorkSnapshot === undefined
        ? '"''"'
        : `${BRIDGE_DATA_BOUNDARY}\n\n{{${GO_SNAPSHOT_VARIABLE}}}`,
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

work_variable_block='  targets.work.variable(WORK_NOTICE_VARIABLE, () => {
    const notice = awareness.forWorkLane().latestGameNotice
    return notice === undefined ? undefined : renderGameNotice(notice)
  })
'

work_context_block='  targets.work.context({
    name: WORK_NOTICE_CONTEXT,
    order: WORK_NOTICE_ORDER,
    text: () =>
      awareness.forWorkLane().latestGameNotice === undefined
        ? '"''"'
        : `{{${WORK_NOTICE_VARIABLE}}}`,
  })
'

notice_not_last_block='  targets.work.context({
    name: WORK_NOTICE_CONTEXT,
    order: WORK_NOTICE_ORDER,
    text: () =>
      awareness.forWorkLane().latestGameNotice === undefined
        ? '"''"'
        : `{{${WORK_NOTICE_VARIABLE}}}\n\n${BRIDGE_DATA_BOUNDARY}`,
  })
'

stale_work_variable_block='  let firstNotice: GameNotice | undefined
  targets.work.variable(WORK_NOTICE_VARIABLE, () => {
    const notice = awareness.forWorkLane().latestGameNotice
    if (notice === undefined) return undefined
    firstNotice ??= notice
    return renderGameNotice(firstNotice)
  })
'

pad_from='      lines.push(
        `- ${group.owner} stones=${group.stones} liberties ${group.libertiesBefore}->${group.libertiesAfter}`,
      )'

pad_to='      lines.push(
        `- ${group.owner} stones=${group.stones} liberties ${group.libertiesBefore}->${group.libertiesAfter}${'"'"'x'"'"'.repeat(1000)}`,
      )'

noop_from='  return lines.join('"'"'\n'"'"')
}

export function bindBridgeDelivery'

noop_to='  return '"''"'
}

export function bindBridgeDelivery'

survived=0
run_mutant() {
  local name=$1 from=$2 to=$3
  local dir
  dir=$(mktemp -d "$tests_dir/bridge-delivery-mutant-$name.XXXXXX")
  cp "$script_dir/bridge-delivery.fixture.ts" "$dir/bridge-delivery.spec.ts"
  cp -R "$plugin_root/src" "$dir/plugin"

  if ! node --input-type=module - "$dir/plugin/bridge/delivery.ts" "$from" "$to" <<'NODE'
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
  elif grep -qE 'Tests +[0-9]+ failed' "$log"; then
    echo "mutant $name killed by a failing test — see $log"
    grep -m1 -E 'AssertionError' "$log" | cut -c1-160
  else
    echo "mutant $name produced no failing test (compile/import failure) — see $log"
    survived=$((survived + 1))
  fi
}

run_mutant context-seam-for-go "$section_block" "$context_block"
run_mutant no-go-registration "$section_block" ''
run_mutant pad "$pad_from" "$pad_to"
run_mutant stale "$work_variable_block" "$stale_work_variable_block"
run_mutant noop "$noop_from" "$noop_to"
run_mutant notice-not-last "$work_context_block" "$notice_not_last_block"

if [[ $survived -ne 0 ]]; then
  echo "RESULT: FAIL — $survived mutant(s) survived; the gate does not prove the property"
  exit 1
fi
echo "RESULT: PASS — every mutant was killed by a failing test"
