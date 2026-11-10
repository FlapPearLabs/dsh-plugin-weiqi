#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

mode="${1:-smoke}"
case "$mode" in
  smoke|full|render) ;;
  *)
    printf 'usage: %s [smoke|full|render]\n' "$0" >&2
    exit 2
    ;;
esac

if [ "$mode" = "render" ]; then
  export C_T10_RENDER_REPORT=1
  pnpm exec vitest run tests/benchmark/render-live-calibration.test.ts
  exit 0
fi

# <home>/.hermes/.env is not sourceable here: one value contains an unquoted path
# with spaces. Read only the one variable, and never echo it. An explicit
# BENCHMARK_API_KEY wins over the OpenCode Go credential.
env_file="${HERMES_ENV_FILE:-$HOME/.hermes/.env}"
key="${BENCHMARK_API_KEY:-${OPENCODE_GO_API_KEY:-}}"
if [ -z "$key" ] && [ -f "$env_file" ]; then
  key="$(grep -E '^OPENCODE_GO_API_KEY=' "$env_file" | tail -n 1 | cut -d= -f2-)"
  key="${key%\"}"
  key="${key#\"}"
  key="${key%\'}"
  key="${key#\'}"
fi
if [ -z "$key" ]; then
  printf 'live calibration refused; OPENCODE_GO_API_KEY is unset (BENCHMARK_API_KEY is empty) and %s has no entry\n' "$env_file" >&2
  exit 2
fi

# The official OpenCode Go chat-completions entry for DeepSeek V4.1 Flash
# (https://opencode.ai/docs/go/, captured 2026-11-06). /zen/v1 is the ordinary
# Zen entry, not the Go subscription entry. Explicit BENCHMARK_* values always
# win, so the same runner can point at another router when the owner approves.
default_base_url="https://opencode.ai/inference/go/openai/v1"
default_pricing='{"inputUsdPerMillionTokens":0.3,"outputUsdPerMillionTokens":1.2,"cacheReadUsdPerMillionTokens":0.006}'
export BENCHMARK_PROVIDER="live"
export BENCHMARK_BASE_URL="${BENCHMARK_BASE_URL:-$default_base_url}"
export BENCHMARK_MODEL="${BENCHMARK_MODEL:-deepseek-v4.1-flash}"
export BENCHMARK_PRICING_JSON="${BENCHMARK_PRICING_JSON:-$default_pricing}"
export BENCHMARK_API_KEY="$key"
export C_T10_LIVE_CALIBRATION="$mode"

# An empty SSL_CERT_FILE from the agent environment makes every TLS request
# fail before it leaves; Node's bundled roots plus NODE_EXTRA_CA_CERTS suffice.
unset SSL_CERT_FILE

# Direct connections to this endpoint intermittently hit undici's 10 s connect
# timeout (probe 2026-11-06: direct 3/5 success, one UND_ERR_CONNECT_TIMEOUT;
# the already-exported proxy answered 3/3 POSTs). NODE_USE_ENV_PROXY makes the
# runtime honor the proxy settings already present in the environment; the
# equivalent --use-env-proxy flag is not applied through NODE_OPTIONS. No proxy
# setting or credential is changed.
export NODE_USE_ENV_PROXY=1
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --no-network-family-autoselection"

# The default Vitest reporter prints console output only for failing tests.
# Every paid request row is printed by the runner, so a successful calibration
# must still show its evidence in the log; verbose keeps it.
pnpm exec vitest run --reporter=verbose tests/benchmark/run-live-calibration.paid.test.ts
