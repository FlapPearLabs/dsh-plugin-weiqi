#!/usr/bin/env bash
set -uo pipefail

# Falsifiability check for the section spike fixture: each mutant breaks one
# property the fixture claims, so the corresponding assertions must go red.
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
fixture="${FIXTURE:-$script_dir/system-prompt-section.spec.ts}"
dsh_root=$(cd "$DSH_PINNED_ROOT" && pwd)
tests_dir="$dsh_root/packages/core/agent-loop/tests"
log_dir="${LOG_DIR:-/tmp/section-mutations}"
mkdir -p "$log_dir"

mutants=(frozen-value wrong-agent-scope changing-text raw-concatenation)

mutate() {
  local name=$1 from=$2 to=$3 target="$tests_dir/system-prompt-section.mutant-$1.spike.spec.ts"
  if ! node --input-type=module - "$fixture" "$target" "$from" "$to" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const [source, target, from, to] = process.argv.slice(2)
const text = readFileSync(source, 'utf8')
if (!text.includes(from)) {
  console.error(`mutant anchor not found: ${JSON.stringify(from.slice(0, 60))}`)
  process.exit(4)
}
writeFileSync(target, text.replace(from, to))
NODE
  then
    echo "FAIL setup: could not build mutant $name" >&2
    exit 2
  fi
  echo "mutant $name -> $target"
}

cleanup() {
  rm -f "$tests_dir"/system-prompt-section.mutant-*.spike.spec.ts
}
trap cleanup EXIT

mutate frozen-value \
  'agent.ctx.systemPrompt.variable(SNAPSHOT_VARIABLE, () => holder.value)' \
  'const frozen = holder.value; agent.ctx.systemPrompt.variable(SNAPSHOT_VARIABLE, () => frozen)' || exit $?
mutate wrong-agent-scope \
  "registerSectionSnapshot(go, { value: 'G0' }, trace)" \
  "registerSectionSnapshot(work, { value: 'G0' }, trace)" || exit $?
mutate changing-text \
  "return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}'" \
  "return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}' + String(stats.evaluations)" || exit $?
mutate raw-concatenation \
  "return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}'" \
  "return holder.value === undefined ? '' : MARKER + holder.value" || exit $?

cd "$dsh_root"
failed=0
survived=0
for name in "${mutants[@]}"; do
  log="$log_dir/$name.log"
  corepack pnpm@11.7.0 exec vitest run --no-file-parallelism --reporter=verbose \
    "packages/core/agent-loop/tests/system-prompt-section.mutant-$name.spike.spec.ts" \
    >"$log" 2>&1
  status=$?
  echo "=== mutant $name exit=$status ==="
  grep -E '^\s+(✓|×)' "$log" || true
  case "$status" in
    0)
      echo "SURVIVED mutant $name: tests passed, so the fixture does not prove this property" >&2
      survived=$((survived + 1))
      ;;
    1)
      # vitest exits 1 on assertion failure; confirm the file actually ran.
      if grep -qE 'Tests\s+[0-9]+ failed' "$log"; then
        echo "killed mutant $name"
      else
        echo "FAIL setup: mutant $name exited 1 without a failed test (did not run)" >&2
        failed=$((failed + 1))
      fi
      ;;
    *)
      echo "FAIL setup: mutant $name exited $status (infrastructure, not a red test)" >&2
      failed=$((failed + 1))
      ;;
  esac
done

cleanup
trap - EXIT

if [[ $failed -gt 0 ]]; then
  echo "RESULT: untrustworthy — $failed mutant run(s) did not produce a real red test" >&2
  exit 2
fi
if [[ $survived -gt 0 ]]; then
  echo "RESULT: FAIL — $survived mutant(s) survived" >&2
  exit 1
fi
echo "RESULT: PASS — all ${#mutants[@]} mutants killed"
