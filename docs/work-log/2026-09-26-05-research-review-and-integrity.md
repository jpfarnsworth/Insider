# Research review: dollar-volume bug, holdout, offering tag, portfolio view, agent batch

Outside feedback on the results prompted checking the measurement itself. That found a data bug that had inflated costs on nearly every signal, and led to four additions that protect the research from fooling itself: a holdout freeze, an offering-like tag, a calendar-time portfolio and a missing-volume check. A 200-signal Gemini batch was started to see real cost and quality.

## Findings
- `signals.avg_dollar_volume` was empty for 513 of 535 post-cutoff signals (stale until `compute-outcomes` re-ran), so unknown volume charged the 1.0% thin-name cost to almost everything. After the fix, 516 of 535 are filled. Net 30-day mean vs SPY moved from -1.21% to -0.57% (t -0.7); 90-day from -3.73% to -3.09% (t -2.0). Gate 2 still fails.
- Against IWM the result is worse, not better (small caps outperformed in this window), so it is not a small-cap benchmark artifact.
- Weekly-clustered t-stats were similar to the naive ones. 10b5-1 buys were already excluded. Entry timing checked: every after-close and intraday signal enters on a later open (no look-ahead).
- Clusters whose buys were all one day at one price (offering/conversion-like, 90 of 535) average about -6.4% at 30 days; the rest about +0.4% (not significant). This was found by looking at post-cutoff results, so it is a hypothesis to confirm on the holdout.

## What changed
- **Holdout** (`lib/research/holdout.ts`, Settings, default from 2026-10-01): held-out signals carry no outcomes in any aggregate, gate, list, export, page or MCP tool until revealed (a versioned setting).
- **Tag** `single_day_single_price` (`lib/clusters/tags.ts`, `signals.tags`): filter/exclude in list, CSV, MCP and a Performance toggle. Gates always use every signal.
- **Calendar-time portfolio** (`lib/analytics/portfolio*.ts`): equal-weight daily portfolio, Newey-West t-stat; on Performance and in MCP `get_performance`. Its return math reproduces stored outcomes exactly. Net 30-day hold vs SPY: -9 bp/day (t -1.8) all signals; -3 bp/day (t -0.6) excluding offering-like. It weights days equally, so it can differ from per-signal averages.
- **Missing-volume check** on `/system`; `compute-outcomes` records the count.
- Gemini checks: the request has no `tools` (no Search grounding); documented cutoff January 2025 matches the code.

## Agent batch
- `score-agent --limit=200` started in the background; about $0.0066 per signal (about 3.4k tokens in, 2.2k out, about 10 s each). 139 evaluations stored at the time of writing, none failed; still running.

## Follow-ups
- Per-model training cutoff (currently one constant) and a buffer just after the cutoff.
- Size-matched benchmark / factor adjustment needs a market-cap data source.
- Judge the offering-like exclusion and any rule changes on the holdout, which starts filling on 2026-10-01.
