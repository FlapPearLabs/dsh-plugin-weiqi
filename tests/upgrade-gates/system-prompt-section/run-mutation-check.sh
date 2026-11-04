#!/usr/bin/env bash
set -euo pipefail

# Falsifiability check for the section spike fixture: each mutant breaks one
# property the fixture claims, so the corresponding assertions must go red.
# Mutants live only in the pinned test directory and are removed on exit.

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

mutate() {
  local name=$1 from=$2 to=$3 target="$tests_dir/system-prompt-section.mutant-$1.spike.spec.ts"
  node --input-type=module - "$fixture" "$target" "$from" "$to" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const [source, target, from, to] = process.argv.slice(2)
const text = readFileSync(source, 'utf8')
if (!text.includes(from)) {
  console.error(`mutant anchor not found: ${JSON.stringify(from.slice(0, 60))}`)
  process.exit(4)
}
writeFileSync(target, text.replace(from, to))
NODE
  echo "mutant $name -> $target"
}

mutate frozen-value \
  'agent.ctx.systemPrompt.variable(SNAPSHOT_VARIABLE, () => holder.value)' \
  'const frozen = holder.value; agent.ctx.systemPrompt.variable(SNAPSHOT_VARIABLE, () => frozen)'
mutate wrong-agent-scope \
  "registerSectionSnapshot(go, { value: 'G0' }, trace)" \
  "registerSectionSnapshot(work, { value: 'G0' }, trace)"
mutate changing-text \
  "return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}'" \
  "return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}' + String(stats.evaluations)"
mutate raw-concatenation \
  "return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}'" \
  "return holder.value === undefined ? '' : MARKER + holder.value"

cleanup() {
  rm -f "$tests_dir"/system-prompt-section.mutant-*.spike.spec.ts
}
trap cleanup EXIT

cd "$dsh_root"
for name in frozen-value wrong-agent-scope changing-text raw-concatenation; do
  log="$log_dir/$name.log"
  set +e
  corepack pnpm@11.7.0 exec vitest run --no-file-parallelism --reporter=verbose \
    "packages/core/agent-loop/tests/system-prompt-section.mutant-$name.spike.spec.ts" \
    >"$log" 2>&1
  status=$?
  set -e
  echo "=== mutant $name exit=$status ==="
  grep -E '^\s+(✓|×)' "$log" || true
done
cleanup
trap - EXIT
