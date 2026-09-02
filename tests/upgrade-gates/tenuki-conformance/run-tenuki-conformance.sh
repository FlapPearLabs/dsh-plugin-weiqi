#!/usr/bin/env bash
set -euo pipefail

# WAVE-B-S01 — Tenuki version + conformance spike (GitHub #10, BL-GR-03)
#
# Obtains the exact pinned tenuki tarball, verifies its SHA-512 against the
# recorded npm-integrity BEFORE anything is installed or executed, then installs
# and runs the conformance spec against that verified archive. The plugin
# manifest is NOT modified: B-T02 owns the production pin (Expected Surfaces:
# src/rules/tenuki-adapter.ts, package.json pin).
#
# Mirrors the C-S01 / E-S01 runner convention (pinned external dependency +
# version assertion + dedicated spec execution).
#
# TRACE_LOG (optional): when set, EVERY stage below is captured into the file in
# execution order — Node preflight, exact Tenuki version, archive integrity
# verification, installed-package verification, Vitest output, and a terminal
# FINAL RESULT on every exit path (PASS or FAIL) — so the uploaded artifact is
# self-contained evidence of exact package + conformance result.

expected_tenuki_version=0.3.1
# npm-integrity (sha512 of the tenuki-0.3.1 tarball) recorded in
# docs/validation/TENUKI_CONFORMANCE_VERIFIED.md; the runner constant and the
# doc record must agree.
expected_tenuki_integrity='sha512-4obVv+CHn0QXrtHEZOYXE69xweUAae/iHfEz6oqM+dKTcdL8b0G44knfjLtepu4UHdwW0OzxurXDXoZKzKOIIQ=='
# sha1 of package.json inside that tarball, also recorded in the validation doc;
# binds the installed tree the spec executes against to the verified archive.
expected_package_json_shasum='d0cd7c688ccbfed6284df287267241179dae3525'
expected_node=${EXPECTED_NODE:-v24.11.1}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_root=$(cd "$script_dir/../../.." && pwd)

main() {
  final_result=FAIL
  scratch_dir=$(mktemp -d)
  if command -v cygpath >/dev/null 2>&1; then
    scratch_dir=$(cygpath -w "$scratch_dir")
  fi

  cleanup() {
    rm -rf "$scratch_dir" 2>/dev/null || true
  }
  finish() {
    cleanup
    # Terminal result token on EVERY exit path, so the retained trace always
    # states the outcome (self-contained evidence requirement).
    if [[ "$final_result" == PASS ]]; then
      echo "FINAL RESULT: PASS (tenuki@$expected_tenuki_version conformance)"
    else
      echo "FINAL RESULT: FAIL (tenuki@$expected_tenuki_version conformance)" >&2
    fi
  }
  trap finish EXIT

  # 1. Node / version preflight.
  actual_node=$(node --version)
  echo "TRACE preflight node=$actual_node expected=$expected_node tenuki=$expected_tenuki_version"
  if [[ "$actual_node" != "$expected_node" ]]; then
    echo "FATAL node version mismatch: expected $expected_node, got $actual_node" >&2
    exit 1
  fi

  # 2. Obtain the exact tarball (npm pack downloads the published archive).
  echo "TRACE packing tenuki@$expected_tenuki_version"
  npm pack --silent --pack-destination "$scratch_dir" "tenuki@$expected_tenuki_version" >/dev/null
  tarball="$scratch_dir/tenuki-$expected_tenuki_version.tgz"

  # 3. Verify the ACTUAL archive sha512 (npm-integrity representation) against
  #    the recorded expected integrity BEFORE any install or test.
  actual_integrity=$(node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');process.stdout.write('sha512-'+createHash('sha512').update(readFileSync(process.argv[1])).digest('base64'))" "$tarball")
  echo "TRACE archive integrity actual=$actual_integrity"
  if [[ "$actual_integrity" != "$expected_tenuki_integrity" ]]; then
    echo "FATAL archive integrity mismatch: expected $expected_tenuki_integrity, got $actual_integrity" >&2
    exit 1
  fi
  echo "TRACE archive integrity OK (matches recorded sha512)"

  # 4. Install from the VERIFIED archive file only.
  echo "TRACE installing verified archive"
  npm install --silent --no-save --prefix "$scratch_dir/install" "$tarball"
  tenuki_root="$scratch_dir/install/node_modules/tenuki"

  # 5. Installed-package verification: version AND content (package.json sha1)
  #    must match the verified archive, so the executed tree is content-bound
  #    to the pinned archive, not merely semver-labelled.
  echo "TRACE verifying installed package"
  node - "$tenuki_root" "$expected_tenuki_version" "$expected_package_json_shasum" <<'NODE'
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')

const [root, expectedVersion, expectedShasum] = process.argv.slice(2)
const manifestPath = join(root, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.version !== expectedVersion) {
  console.error(`FATAL tenuki version mismatch: expected ${expectedVersion}, got ${manifest.version}`)
  process.exit(1)
}
const bytes = readFileSync(manifestPath)
const actualShasum = createHash('sha1').update(bytes).digest('hex')
if (actualShasum !== expectedShasum) {
  console.error(`FATAL installed package.json shasum mismatch: expected ${expectedShasum}, got ${actualShasum}`)
  process.exit(1)
}
console.log(`TRACE installed tenuki@${manifest.version} package.json sha1=${actualShasum}`)
NODE

  # 6. Conformance spec against the verified archive.
  echo "TRACE running conformance spec"
  cd "$plugin_root"
  TENUKI_ROOT="$tenuki_root" \
    ./node_modules/vitest/vitest.mjs run --no-file-parallelism --config \
    tests/upgrade-gates/tenuki-conformance/tenuki-conformance.vitest.config.ts
  final_result=PASS
}

if [[ -n "${TRACE_LOG:-}" ]]; then
  main 2>&1 | tee "$TRACE_LOG"
else
  main
fi
