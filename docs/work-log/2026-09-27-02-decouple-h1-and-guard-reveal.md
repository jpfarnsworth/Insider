# Decouple H1 from the agent; lock and audit the holdout reveal

Outside review flagged two problems with yesterday's pre-registration: H1 (gate 2) was defined on "signals scored by both," so it would silently stop accumulating if agent scoring ever stalled, even though H1 is a baseline-only question. And the holdout reveal was a single unguarded checkbox, with no record of when or why it was flipped, and no way to see a test's result without exposing every individual holdout return at once.

## H1 decoupled from the agent
- **Before:** H1's top tier was baseline top third OR agent top third (union), computed only over signals scored by both.
- **Now:** H1 is the baseline's top third alone, over every holdout signal with a matured outcome, independent of the agent. Recorded as a dated deviation in `docs/preregistration.md`, fixed before any holdout signal existed. `lib/analytics/prereg.ts`'s `topTierMean` and H1's `select` no longer touch the agent score at all.

## Reveal is now decoupled, locked and audited
Each test now computes its own result as soon as it reaches its registered size, with **no reveal required**. Reveal controls something narrower: whether individual holdout signals become visible anywhere (their own page, the signals list, CSV, MCP) -- that stays fully masked (no outcomes at all) regardless of how the tests are doing.

- `lib/analytics/load.ts`: `loadSignalFacts(db, { forTests })` -- when true, skips the outcome-masking for holdout-window signals (but leaves `holdout`/`holdoutWindow` computed from the real state, unaffected). `lib/analytics/cache.ts` adds `getCachedSignalFactsForTests()` alongside the existing masked `getCachedSignalFacts()`. Only the gates/prereg calculation may use the unmasked variant; it reports an aggregate number, never a per-signal one.
- `lib/analytics/gates.ts`: `evaluateGates` takes an optional `testFacts` array, used only for the official H1/H2 calculation; gate 1, gate 4 and the design-set/interim numbers are unaffected.
- `lib/analytics/prereg.ts`: `canReveal(results, abandonReason)` -- pure, tested. Refuses reveal while any test is `awaiting` unless a reason of 20+ characters is given; records which tests were still pending.
- `lib/research/holdout.ts`: schema gains `revealedAt`, `revealedBy` (set by the app, not the form, the moment reveal flips false to true), `abandonReason`, `abandonedTests`.
- `app/(app)/settings/actions.ts`: `holdoutAction` runs `canReveal` against `getCachedSignalFactsForTests()` before allowing `reveal: true`; refuses to change `from` while already revealed unless `reveal` is turned back off in the same save (prevents opening a new window under the old audit trail).
- Settings page shows each test's live status (Awaiting/Supported/Not supported) with its progress, and the reveal timestamp/author once set.
- `docs/preregistration.md`: new "Revealing the holdout" section records the locked/audited mechanism and the rule that a revealed holdout is spent -- any new idea (a filter, a prompt version) needs a fresh window starting on or after the reveal date, registered the same way.

## Verified
- 451 tests pass, including 16 new/updated in `prereg.test.ts` (H1 ignoring the agent, `canReveal`'s accept/reject/whitespace cases).
- Against the real database: temporarily backdated the holdout to 2025-06-01 (403 signals in window), confirmed the masked view showed 0 with visible outcomes while the unmasked (`forTests`) view showed all 403, confirmed `holdout` flags agreed, then restored the original setting exactly (byte-for-byte, no stray version row). Ran `evaluatePrereg` + `canReveal` against that real data end to end (all three tests resolved; `canReveal` returned ok).
- In the browser, live: checked "Reveal" with no reason and submitted -- the server correctly refused it with a message naming H1, H2 and H3 as pending. Did not test the accept path against the live setting, to avoid actually revealing the real holdout for a test; that path is covered by `canReveal`'s unit tests and the same `save()` helper used by every other settings action.
