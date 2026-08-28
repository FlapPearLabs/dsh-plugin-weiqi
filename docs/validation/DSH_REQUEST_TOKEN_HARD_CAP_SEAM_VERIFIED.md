# Pinned DSH request token hard-cap seam

**Status:** EXECUTABLE-VERIFIED for WAVE-C-S01 / GitHub #17

**DSH commit:** `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

**DSH packages:** `0.1.1-rc.2`

**Node:** `24.11.1`

**pnpm:** `11.7.0`

## Conclusion

Companion Go can enforce its absolute output-token ceiling without modifying
DSH core. Register an agent-scoped `agent/request` waterfall listener on the
Go agent, await the proposed `LlmCallConfig`, and return a replacement whose
`maxTokens` is clamped to the Companion hard cap.

The seam runs once for every AgentLoop model request. Registering it through
the Go agent's `agent.ctx` makes it agent-scoped: it is not a process-wide or
session-store-wide setting. The effective value is also recorded in that
session's request header so later requests reconstruct the same bounded call
configuration unless the waterfall returns another explicitly bounded value.

## Exact pinned-source path

At the pinned commit:

1. `AgentOptions.maxTokens` seeds the first request proposal in
   `packages/core/agent-loop/src/agent.ts:438-460`.
2. The scoped `agent/request` waterfall accepts and returns `LlmCallConfig` at
   `packages/core/agent/src/runtime-types.ts:232-244`.
3. `LlmCallConfig.maxTokens` is the provider-neutral field at
   `packages/llm/llm/src/call-config.ts:23-29`.
4. AgentLoop resolves the returned config, stores it in `request/header`, and
   spreads it into the frozen `GenerateOptions` request at
   `packages/core/agent-loop/src/agent.ts:457-513`.
5. `prepareCall()` binds that same config to the selected adapter and rejects
   pre-dispatch drift at `packages/llm/llm/src/index.ts:824-868`.
6. The pinned DeepSeek adapter serializes `GenerateOptions.maxTokens` as the
   actual chat-completions wire field `max_tokens` at
   `packages/llm/llm-deepseek/src/serialize.ts:353-365`.

## Executed proof

The retained fixture mounts the real pinned `LlmRuntime`, DeepSeek adapter,
`SessionStore`, `AgentRegistry`, and `AgentLoop`. It sends requests to a local
HTTP receiver through the real DeepSeek adapter transport.

The fixture starts both agents with an oversized `8,192` proposal, installs a
`257` clamp only on the Go agent, and asserts:

```text
Go waterfall proposal: 8192 -> clamped: 257
Go request/header maxTokens: 257
Go outgoing JSON max_tokens: 257
Work request/header maxTokens: 8192
Work outgoing JSON max_tokens: 8192
```

This proves request lifecycle placement, propagation to the wire request, and
agent scoping without a DSH core patch. `257` and `8,192` are deliberately
diagnostic fixture values; they are not production budget choices.

Run from an installed pinned DSH checkout:

```bash
DSH_PINNED_ROOT=/absolute/path/to/deepseek-harness \
  bash tests/upgrade-gates/request-token-hard-cap/run-request-token-hard-cap.sh
```

## Downstream contract for C-T07

C-T07 may implement a small Go-agent-owned listener at this exact seam. It
must clamp the result of `await next()` rather than merely propose a default,
so model selection or another legitimate request contributor cannot raise the
absolute cap. It must keep production numeric values benchmark-owned by C-T10.
No generalized LLM adapter, middleware platform, or DSH patch is justified.
