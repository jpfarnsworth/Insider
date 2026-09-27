# Lock the holdout start date; surface the reveal reason next to the test results

Second look at yesterday's reveal-gating turned up two more gaps: the holdout start date itself was still freely editable (the weakest point, since moving it after seeing design-set results decides after the fact which signals count as holdout), and an early-reveal reason was only visible on the Settings page, not next to the test results it explains.

## What changed
- **`from` is locked**, as of this registration (2026-09-27), not just once the window opens. `canChangeFrom` (`lib/research/holdout.ts`, pure, tested) refuses any change without a written reason of 20+ characters -- earlier, later, before or after a reveal, unconditionally. Every change is logged permanently in `holdout.fromChanges` (timestamp, who, old value, new value, reason verbatim), shown on the Settings page.
- `holdoutAction` enforces this before anything else; verified live that changing the date with no reason is refused and the stored setting is untouched (checked the database directly).
- The early-reveal reason, its timestamp and who did it now appear on the Performance page's "Pre-registered holdout tests" panel and in MCP `get_performance`'s output (`preregisteredTests.revealed`), not only in Settings.
- Fixed a real bug while wiring this up: MCP `get_performance`'s `preregisteredTests.holdout` was computing the official test result from the *masked* facts (`getCachedSignalFacts`) instead of the unmasked `getCachedSignalFactsForTests` already used by `evaluateGates` in the same function -- it would have shown H1/H2/H3 as permanently `awaiting` over MCP even after they'd resolved on the Performance page. Caught by re-checking consistency after adding the `revealed` field, before this ever ran against real holdout data.

## Verified
- 455 tests pass, including 5 new `canChangeFrom` cases.
- Live in the browser: submitted a changed `from` with no reason -- refused with a clear message; confirmed via a direct database read that the stored setting was untouched (no version row, no field changed).
- `canChangeFrom` exercised directly for the accept path (valid 20+ character reason) rather than against the live setting, to avoid actually moving the real registered date for a test.
