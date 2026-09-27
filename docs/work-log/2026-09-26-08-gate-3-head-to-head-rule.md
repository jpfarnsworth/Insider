# Gate 3: equal top thirds, weekly-block bootstrap, agent dropped on a tie

Gate 3 (does the agent beat the baseline?) is now a single pre-committed rule that compares like with like and accounts for overlapping, same-week signals. The official verdict waits for the holdout, because the rule was chosen after the design set had been looked at.

## Why
- The old rule (agent score >= 70 vs baseline top third) compared very different groups: the agent's scores are bunched (quartiles 65/75/82, 22 distinct values), so 70 selects about two thirds of signals. The verdict also flipped with the tier definition (fixed 70: baseline ahead; top third: agent ahead by 0.3 points), so a point comparison meant nothing.
- The two tiers come from the same signals and overlap heavily, and signals in the same week move together, so a two-sample test would get the noise wrong.

## What changed (`lib/analytics/head-to-head.ts`, `gates.ts`)
- Tiers: top third by each scorer's own rank on signals scored by both with a complete 30-day net outcome. Ties at the boundary share weight so each tier is exactly n/3.
- Statistic: agent tier mean minus baseline tier mean. Interval: resample whole calendar weeks of the shared set, rebuild BOTH tiers each time, 2000 resamples, seeded (reproducible), 95% percentile interval.
- Rule: keep the agent only if the interval is above zero. No distinguishable difference, or the baseline ahead, drops it (the spec already allows dropping the agent; it costs money and adds complexity). Needs 20+ per tier (60+ shared signals with complete outcomes).
- Spearman correlation with the 30-day return over all shared signals is reported as a supporting line, not part of the verdict.
- Official population: only signals on or after the holdout start (`holdoutWindow`), evaluated once the holdout is revealed in Settings. Until then the gate shows "awaits the holdout" plus the design-set result labelled NOT evidence. New `holdoutWindow` flag on signal facts (true whether or not revealed).

## Verified
- 21 gate tests and 12 head-to-head tests: tie weighting, determinism, keep/drop/no-difference/baseline-ahead cases, frozen holdout stays insufficient.
- Interim on real data (299 shared design-set signals, provisional): agent top third +1.89% vs baseline top third +2.53%, difference -0.64 points, 95% interval -4.80 to +4.18. Inconclusive either way; rank correlation with 30-day return agent 0.11, baseline 0.02. Gate evaluation takes about 1.3 s.

## Follow-ups
- Expect the official verdict late in the year or early next: each tier needs 20+ matured holdout signals (about 60 in total) at the current pace of roughly 24 signals a month plus about six weeks for 30-day outcomes.
- Gate 2 was left as specified (union tier on signals scored by both); it is not made official-on-holdout here.
