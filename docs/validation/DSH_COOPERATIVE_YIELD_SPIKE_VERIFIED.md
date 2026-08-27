# DSH COOPERATIVE YIELD SPIKE — VERIFIED RECORD

## Final Result

```text
PASS — COOPERATIVE_YIELD_VERIFIED
```

## Pinned Environment

- DSH commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- DSH packages: root / agent / agent-loop / llm = `0.1.1-rc.2`
- Node: `v24.11.1`
- pnpm: `11.7.0`
- Vitest: `4.1.8`

## Executed Fixture

- `cooperative-yield.spec.ts`
- GitHub Actions: run `#32982062366`
- Result: `3/3 tests passed`

## A. Proposed Main Sequence

Observed:

```text
step/end 1
-> step/start/request 2
-> step/end 2
-> step/start/request 3
-> step/end 3
-> stage A,B
-> claim A,B for proposed step 4
-> C arrives after claim
-> splice restore => [A,B,C]
-> cancel(hook, keepInbox:true), inside pre-step
-> turn/end: aborted / companion-focus-yield
-> idle
-> external companion-resume
-> claim A,B,C,resume
-> turn 2 / step 1
-> completed / idle
```

Result: PASS.

## B. Reject-Only Negative Control

Observed:

```text
splice
-> reject
-> turn/end: blocked
-> idle
-> inbox remains [A,B,C]
```

No same-lane replacement turn automatically started.

Result:

```text
PASS AS A SIMPLER YIELD PATH
```

## C. Deferred-Cancel Negative Control

Observed:

```text
splice
-> reject
-> turn/end: blocked
-> idle
-> deferred cancel fires after idle
-> inbox remains [A,B,C]
```

The deferred cancel provided no additional protection on this pinned commit.

## Message Integrity

Verified:

- inbox after yield exactly `[A,B,C]`;
- no duplicate pending `MessageId`;
- no claimed message loss;
- resume consumption order `A -> B -> C -> companion-resume`;
- durable representation exactly once for restored messages.

## Final Implementation Decision

The experimentally preferred V0.1 cooperative-yield seam for the pinned DSH commit is:

```text
claim continuation messages
-> batch restore with inbox.splice("next-step", 0, 0, payload.messages)
-> return { kind: "reject" }
-> turn/end: blocked
-> whenIdle()
-> switch lane
-> external companion-resume when returning
```

`cancel(..., { keepInbox: true })` remains a real supported DSH API and the original cancel-path also passed, but it is **not necessary** to prevent same-driver restart on `b150a551...`.

## Upgrade Gate

Any DeepSeek Harness version/commit change must rerun this fixture.

Do not assume the following remain stable across DSH upgrades:

- claim-before-pre-step ordering;
- synchronous inbox splice behavior;
- reject -> blocked -> idle convergence;
- same-driver restart behavior;
- resume ordering.

## Stage Transition

```text
Validation Gate A: COMPLETE / PASS
Build Phase A: READY TO START
```
