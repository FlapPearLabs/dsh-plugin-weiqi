#!/usr/bin/env bash
set -euo pipefail

# WAVE-B-S01 — Tenuki version + conformance spike (GitHub #10, BL-GR-03)
#
# Installs the exact pinned tenuki version into a scratch directory, verifies
# the installed version, then runs the conformance spec against it. The plugin
# manifest is NOT modified: B-T02 owns the production pin (Expected Surfaces:
# src/rules/tenuki-adapter.ts, package.json pin).
#
# Mirrors the C-S01 / E-S01 runner convention (pinned external dependency +
# version assertion + dedicated spec execution).

expected_tenuki_version=0.3.1
expected_node=${EXPECTED_NODE:-v24.11.1}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_root=$(cd "$script_dir/../../.." && pwd)

test "$(node --version)" = "$expected_node"
echo "TRACE tenuki pinned=$expected_tenuki_version node=$(node --version)"

scratch_dir=$(mktemp -d)
if command -v cygpath >/dev/null 2>&1; then
  scratch_dir=$(cygpath -w "$scratch_dir")
fi
cleanup() {
  rm -rf "$scratch_dir" 2>/dev/null || true
}
trap cleanup EXIT

echo "TRACE installing tenuki@$expected_tenuki_version into scratch dir"
npm install --no-save --prefix "$scratch_dir" "tenuki@$expected_tenuki_version" >/dev/null

tenuki_root="$scratch_dir/node_modules/tenuki"
node - "$tenuki_root" "$expected_tenuki_version" <<'NODE'
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')

const [root, expected] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.version !== expected) {
  console.error(`tenuki version mismatch: expected ${expected}, got ${manifest.version}`)
  process.exit(1)
}

// Integrity pin from docs/validation/TENUKI_CONFORMANCE_VERIFIED.md: the exact
// tenuki@0.3.1 tarball's package.json (sha1 of the file inside the npm tarball),
// pinning content, not just the semver label.
const expectedShasum = 'd0cd7c688ccbfed6284df287267241179dae3525'
const manifestPath = join(root, 'package.json')
const bytes = readFileSync(manifestPath)
const actualShasum = createHash('sha1').update(bytes).digest('hex')
if (actualShasum !== expectedShasum) {
  console.error(`tenuki package.json shasum mismatch: expected ${expectedShasum}, got ${actualShasum}`)
  process.exit(1)
}

console.log(`TRACE installed tenuki@${manifest.version} shasum=${actualShasum}`)
NODE

cd "$plugin_root"
if [[ -n "${TRACE_LOG:-}" ]]; then
  TENUKI_ROOT="$tenuki_root" \
    ./node_modules/vitest/vitest.mjs run --no-file-parallelism --config \
    tests/upgrade-gates/tenuki-conformance/tenuki-conformance.vitest.config.ts 2>&1 \
    | tee "$TRACE_LOG"
else
  TENUKI_ROOT="$tenuki_root" \
    ./node_modules/vitest/vitest.mjs run --no-file-parallelism --config \
    tests/upgrade-gates/tenuki-conformance/tenuki-conformance.vitest.config.ts
fi
