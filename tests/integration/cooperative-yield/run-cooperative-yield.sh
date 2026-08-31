#!/usr/bin/env bash
set -euo pipefail

expected_dsh_commit=b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
expected_dsh_version=0.1.1-rc.2
expected_node=v24.11.1
expected_pnpm=11.7.0

if [[ -z "${DSH_PINNED_ROOT:-}" ]]; then
  echo "DSH_PINNED_ROOT must point to the pinned deepseek-harness checkout" >&2
  exit 2
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_root=$(cd "$script_dir/../../.." && pwd)
dsh_root=$(cd "$DSH_PINNED_ROOT" && pwd)

test "$(git -C "$dsh_root" rev-parse HEAD)" = "$expected_dsh_commit"
test "$(node --version)" = "$expected_node"
test "$(corepack pnpm@11.7.0 --version)" = "$expected_pnpm"

node --input-type=module - "$dsh_root" "$expected_dsh_version" <<'NODE'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [root, expected] = process.argv.slice(2)
for (const file of [
  'package.json',
  'packages/core/agent/package.json',
  'packages/core/agent-loop/package.json',
  'packages/core/session/package.json',
  'packages/llm/llm/package.json',
  'packages/core/tools/package.json',
]) {
  const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'))
  if (manifest.version !== expected) {
    throw new Error(`${file}: expected ${expected}, received ${manifest.version}`)
  }
  console.log(`${file}: ${manifest.name}@${manifest.version}`)
}
NODE

fixture_root=$(mktemp -d "$dsh_root/packages/core/agent-loop/tests/companion-go-cooperative-yield.XXXXXX")
cleanup_fixture() {
  rm -rf "$fixture_root"
}
trap cleanup_fixture EXIT

cp "$script_dir/cooperative-yield.fixture.ts" "$fixture_root/cooperative-yield.spec.ts"
cp -R "$plugin_root/src" "$fixture_root/plugin"

relative_spec=${fixture_root#"$dsh_root/"}/cooperative-yield.spec.ts
cd "$dsh_root"
command=(corepack pnpm@11.7.0 exec vitest run --no-file-parallelism --reporter=verbose "$relative_spec")
if [[ -n "${TRACE_LOG:-}" ]]; then
  "${command[@]}" 2>&1 | tee "$TRACE_LOG"
else
  "${command[@]}"
fi
