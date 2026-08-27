#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_dir=$(cd "$script_dir/../.." && pwd)
dsh_source_dir=${DSH_SOURCE_DIR:?Set DSH_SOURCE_DIR to the pinned DeepSeek Harness checkout}
profile_smoke_root=${PROFILE_SMOKE_ROOT:-$(mktemp -d)}
profile_name=${DSH_PROFILE_NAME:-companion-go-foundation-smoke}
dsh_home_path="$profile_smoke_root/dsh-home"
artifact_dir="$profile_smoke_root/artifacts"
profile_dump_path="$profile_smoke_root/profile-dump.yml"
dsh_cli_path="$dsh_source_dir/apps/cli/lib/bin.js"

mkdir -p "$artifact_dir" "$dsh_home_path"

actual_dsh_commit=$(git -C "$dsh_source_dir" rev-parse HEAD)
expected_dsh_commit=b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
if [[ "$actual_dsh_commit" != "$expected_dsh_commit" ]]; then
  echo "Expected DSH $expected_dsh_commit, got $actual_dsh_commit" >&2
  exit 1
fi
if [[ ! -f "$dsh_cli_path" ]]; then
  echo "Pinned DSH built CLI is missing; run 'pnpm run build:lib:host' in the DSH checkout" >&2
  exit 1
fi

echo "TRACE pin dsh=$actual_dsh_commit node=$(node --version) pnpm=$(pnpm --version)"
echo "TRACE package build start"
pnpm --dir "$plugin_dir" run clean
pnpm --dir "$plugin_dir" run build

echo "TRACE package pack start"
pnpm --dir "$plugin_dir" pack --pack-destination "$artifact_dir"
mapfile -t packed_tarballs < <(find "$artifact_dir" -maxdepth 1 -type f -name '*.tgz' -print)
if [[ ${#packed_tarballs[@]} -ne 1 ]]; then
  echo "Expected exactly one packed tarball, found ${#packed_tarballs[@]}" >&2
  exit 1
fi
packed_tarball=${packed_tarballs[0]}

tar -tzf "$packed_tarball" | grep -Fx 'package/cordis.patch.yml' >/dev/null
tar -xOzf "$packed_tarball" package/package.json | node --input-type=module -e '
  import { readFileSync } from "node:fs"
  const manifest = JSON.parse(readFileSync(0, "utf8"))
  if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    throw new Error("packed artifact does not declare dsh.bundle.patch")
  }
  console.log(`TRACE packed bundle declaration=${manifest.dsh.bundle.patch}`)
'
echo "TRACE packed artifact includes cordis.patch.yml"

echo "TRACE cli install command=dsh plugin --profile $profile_name add <packed-tarball>"
env DSH_HOME="$dsh_home_path" node "$dsh_cli_path" plugin --profile "$profile_name" add "$packed_tarball"

echo "TRACE profile dump command=dsh --profile $profile_name --dump-config"
env DSH_HOME="$dsh_home_path" node "$dsh_cli_path" --profile "$profile_name" --dump-config > "$profile_dump_path"

env \
  DSH_HOME="$dsh_home_path" \
  DSH_PROFILE_DUMP="$profile_dump_path" \
  DSH_PROFILE_NAME="$profile_name" \
  DSH_SOURCE_DIR="$dsh_source_dir" \
  node "$script_dir/profile-mount-smoke.mjs"

echo "TRACE result=PASS bundle-recognized patch-applied plugin-mounted product-logic=absent"
