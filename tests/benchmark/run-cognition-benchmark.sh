#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

out="${COGNITION_BENCHMARK_OUT:-docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json}"
export COGNITION_BENCHMARK_OUT="$out"

pnpm exec vitest run tests/benchmark/emit-cognition-benchmark.test.ts

echo "cognition benchmark record: $out"
