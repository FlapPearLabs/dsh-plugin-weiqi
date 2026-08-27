# Project Context

Companion Go embeds a deterministic Go world inside DeepSeek Harness while
preserving DeepSeek as the sole live strategic decision-maker. The product uses
one visible Companion identity, two isolated durable sessions, and at most one
foreground cognition lane. Small factual projections provide cross-lane
awareness; exact user commands cross lanes only through explicit handoff.

## Truth sources

1. `../spec/SPEC_LEAN_V0.1_R2.4_VERIFIED.md` — architecture and product truth.
2. `../validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md` — executed DSH
   runtime evidence.
3. `../design/COMPANION_GO_DESIGN_V4.md` — current UI/UX truth.
4. `../design/prototypes/companion-go-apple-style-v4.html` — interactive design
   reference, not production frontend code.

V4 has already completed the visual and interaction exploration. Future UI
implementation references and adapts V4; it does not reopen the style decision.

## Foundation objective

Establish the smallest testable single-package TypeScript DSH plugin repository
that preserves frozen contracts and can detect DSH cooperative-yield regressions.
No Companion Runtime or Go product behavior belongs in this stage.

## Runtime evidence summary

Pinned DSH `b150a551...` verified the preferred seam:

```text
claim
-> inbox.splice("next-step", 0, 0, payload.messages)
-> reject
-> blocked
-> idle
-> switch
-> external resume
```

`cancel(..., { keepInbox: true })` is a real API and passed, but is unnecessary
for the preferred seam on the pinned commit. Every DSH upgrade must rerun the
fixture instead of assuming these semantics remain stable.
