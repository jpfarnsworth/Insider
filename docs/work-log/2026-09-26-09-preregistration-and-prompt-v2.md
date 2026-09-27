# Pre-register the holdout tests; gate 3 defaults to "not promoted"; prompt v2 attempts

Outside review showed the planned gate 3 test could not realistically be passed at the planned sample size, so the gates were reworked into three pre-registered holdout tests, fixed before any holdout return exists. The agent is no longer up for "drop or keep": it is not promoted by default and runs as a shadow scorer. Prompt v2 (a spread scale) was tried twice and failed the distribution check, so holdout signals keep prompt v1 for now.

## Findings
- Power (subsampled design set): the top-third tier test needs a real gap of about 11 points at 60 shared signals, 7.6 at 150 and about 5 even at 332, so it was effectively decided in advance. The rank-correlation difference (agent minus baseline) has more power: about +/-0.13 at n=332.
- Interim, fully scored design set (473 signals with 30-day outcomes; descriptive, NOT evidence): H1 top-tier mean -0.34% (90% interval -3.1 to +2.2); H2 rank-correlation difference +0.110 (+0.016 to +0.205); H3 offering-like minus rest -6.95 points (-10.8 to -2.6).

## What changed
- `docs/preregistration.md` (registered 2026-09-27, before the holdout window opens): **H1 = gate 2** (top tier, by rank, has mean 30-day net excess > 0, at 90+ shared signals); **H2 = gate 3** (agent rank correlation minus baseline > 0, one-sided, earliest 300 shared signals; registered as underpowered, so an inconclusive result is expected); **H3** (offering-like clusters underperform, at 30+ tagged signals). All: holdout-window signals only, weekly-block bootstrap, one-sided 5%, run once, no multiple-testing correction.
- `lib/analytics/prereg.ts` holds the constants (they are the registration) and the tests; gates 2 and 3 in `gates.ts` are H1 and H2. Gate 3 resolves to "Not promoted (default)": the agent stays a shadow scorer (about $0.16 a month), Phase 2 uses the baseline, and gate 3 never blocks. Design-set figures beside the gates are labelled NOT evidence. New "Pre-registered holdout tests" panel on Performance and in MCP `get_performance`.
- Prompt versions: `lib/agent/prompts/` registry, `promptFor` (design set always v1; holdout v2 only, once adopted), `evaluateBundle` takes the prompt, evaluations record the version used. `npm run prompt:distribution` dry-runs a deterministic 100-signal sample and prints only the score distribution (stores nothing, reads no returns).

## Decisions
- v2 adoption rule fixed in advance and by distribution alone: 40+ distinct scores, at most 40% at 70 or above, IQR 25+, 98%+ valid; at most 3 rounds.
- Round 1 (broader scale wording): 19 distinct, IQR 10, 69% at 70+. Round 2 (percentile framing): 17 distinct, IQR 14, 73% at 70+. Both fail, so `V2_ADOPTED` stays false and the holdout uses v1. Round 3 is still available later; if v2 is ever adopted every holdout signal is re-scored with it (v1 kept), so the holdout never mixes versions.

## Verified
- 435+ tests (prereg statistics, seeded reproducibility, keep/not-promoted/frozen cases, prompt routing); dry runs of 100 signals each returned 100% valid outputs.

## Follow-ups
- The model scores nearly every cluster as good; wording alone may not fix the spread. Rank tests care about ties more than spread. Any relaxation of the criteria is a recorded deviation.
- Reveal the holdout only after the design is frozen; H1 about early to mid 2027, H3 about mid 2027, H2 late 2027.
