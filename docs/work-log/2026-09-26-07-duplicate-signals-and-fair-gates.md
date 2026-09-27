# Fix duplicate signals; make gates 2 and 3 compare like with like

Outside review asked whether RWT and GME appearing twice meant cluster detection creates a new signal when a cluster grows. It does not, but it did create duplicates a different way, and checking the gates afterwards showed gate 3 comparing different time periods rather than different scorers. Both are fixed.

## Findings
- 9 of 535 post-cutoff signals duplicated an earlier one (59 shared purchases): GME and PRTS minutes apart, RWT a day apart, TRIN seven months apart. Cause: detection matches stored to detected clusters by trigger filing; when the trigger changed (a 4/A replaced the completing filing, or late filings reordered acceptance) a second cluster and signal were inserted and the old one left in place. The later duplicate carried a later signal time than when the market knew.
- Clusters that grew normally were already handled (same trigger, updated in place).
- Gate 3 briefly read "Agent wins" (+3.8% vs -0.5%) because the baseline tier spanned all signals while the agent tier existed only for the newest months it had scored (a strong period). On the same signals the verdict is the opposite (see below).

## What changed
- `reconcileIssuer` skips a detected cluster that shares a purchase with a stored one; `supersedeDuplicateSignals` (`lib/clusters/dedupe.ts`, end of `detect-clusters`) marks the later duplicates `superseded`, keeping the earliest signal. 9 signals superseded, 0 created; none deleted (some had agent scores). Superseded signals are excluded from facts, lists, stats, portfolio, alerts and agent runs, and `compute-outcomes` preserves the status. The signal page shows a banner.
- Gates 2 and 3 now use only signals scored by both scorers (`[on N signals scored by both]` in the detail). Same as the spec once every signal is scored. Tests added.

## Verified
- After de-duplication: 592 signals in analytics (526 post-cutoff); 30-day net vs SPY mean -0.46% (t -0.6); calendar-time portfolio -8.6 bp/day (t -1.7), or -2.3 bp/day (t -0.45) excluding offering-like; no overlapping active pairs remain.
- Interim gate read on 219 scored signals: baseline tier +4.0% (n=65) vs agent tier +2.6% (n=123), so "baseline wins" for now. Provisional: the batch is not finished and covers only recent months.

## Follow-up findings (second review)
- **Why the duplicates happened** (checked per signal): mostly late-filed Form 4s, plus amendments. TRIN's later signal (2025-06-10) exists because one purchase dated 2024-11-01 was not filed until 2025-06-10 (221 days late). The original cluster had closed, so replaying the late purchase re-formed the whole cluster and stamped it June 2025. The earliest signal (2024-11-06, when 14 of the 15 purchases became public) is the meaningful one. CBK, PATK, PRTS and SAIC also had late-filed members; PRTS and RWT had amendments; GME had neither (lag 1 day). Detection itself is unchanged: the guard skips and the supersede step cleans up. A cleaner fix would let a late purchase join a closed cluster covering its date.
- **Agent scores are bunched**: quartiles 65/75/82, 22 distinct values, 69% at or above 70, so the fixed 70 cutoff selects the top ~two thirds, not a top tier, while the baseline tier is a top third.
- **Equal-size head-to-head** (top third by each scorer's own rank, 266 signals scored by both with a complete 30-day outcome, interim): agent +2.85% (n=108) vs baseline +2.56% (n=89), essentially a tie; the verdict flips with the tier definition (fixed 70: baseline ahead; top third: agent marginally ahead). Both beat "neither" (+0.9%). Spearman with excess: agent 0.11, baseline 0.03. Not significant either way.
- Gate 2 passing on the interim set is not progress: recent months were strong for everything (a 5-month window).

## Follow-ups
- Re-read gates 2 and 3 when the second agent batch finishes (all matured signals scored).
- Decision to keep the earliest signal is deliberate: it records when the market first knew, and a later amendment does not change that.
