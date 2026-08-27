# V4 Implementation Authority Boundaries

The V4 design document and HTML prototype remain important implementation
references for Companion Go's UI/UX. They do not define product or runtime
behavior unless the verified Spec explicitly delegates that behavior to them.

## V4 is authoritative for

- layout;
- visual hierarchy;
- the Harness-native shell;
- board presentation;
- player spatial presence;
- control placement;
- interaction and animation reference;
- the light, Apple-like visual language.

## V4 is not authoritative for

- Go rules;
- komi;
- scoring;
- Tenuki configuration;
- AI strategy;
- move selection;
- model reasoning behavior;
- Attention runtime semantics;
- model timing;
- `GoTurnBudget`;
- anti-cheat behavior;
- capability policy.

When V4 conflicts with the R2.4 VERIFIED SPEC, **SPEC WINS**.

## Known examples

The V4 prototype displays komi `6.5`, while the R2.4 authoritative Spec fixes
komi at `7.5`. The production implementation must use `7.5`; it must not copy
`6.5` from the prototype.

The random AI logic in the V4 HTML exists only to demonstrate prototype
interaction behavior. It must not enter the production Go strategy or move
selection implementation.
