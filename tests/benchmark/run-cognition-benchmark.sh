#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

out="${COGNITION_BENCHMARK_OUT:-}"

# Live provider mode (WAVE-C-T10). The BENCHMARK_* variables are inherited by
# `pnpm exec vitest`, so no value is copied here; this block only selects the
# mode explicitly and refuses a half-configured live run instead of silently
# falling back to the free scripted provider.
export BENCHMARK_PROVIDER="${BENCHMARK_PROVIDER:-scripted}"
case "$BENCHMARK_PROVIDER" in
  scripted)
    : "${out:=docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json}"
    ;;
  live)
    missing=""
    for name in BENCHMARK_BASE_URL BENCHMARK_API_KEY BENCHMARK_MODEL BENCHMARK_PRICING_JSON; do
      if [ -z "$(printenv "$name" || true)" ]; then
        missing="$missing $name"
      fi
    done
    if [ -n "$missing" ]; then
      printf 'live benchmark refused; missing env:%s\n' "$missing" >&2
      exit 2
    fi
    : "${out:=docs/validation/COGNITION_BENCHMARK_LIVE_RECORD.json}"
    ;;
  *)
    printf 'BENCHMARK_PROVIDER must be scripted or live\n' >&2
    exit 2
    ;;
esac

export COGNITION_BENCHMARK_OUT="$out"

pnpm exec vitest run tests/benchmark/emit-cognition-benchmark.test.ts

echo "cognition benchmark record: $out"
