# Pre-registration: holdout tests

**Registered 2026-09-27 (Chicago), before the holdout window opens (signals from 2026-10-01) and before any holdout return exists.**
The git history of this file is the timestamp. The constants in `lib/analytics/prereg.ts` (`PREREG`) are the machine-readable form of this
document: changing a number there is a new registration, recorded as a new dated section here, never an edit of an old one.

## Why this exists
The design set (post-cutoff signals before 2026-10-01) has been looked at many times, and several rules were chosen after seeing it (the
offering tag, the tier definition for gate 3). Anything found there is a hypothesis. The holdout is the only clean test, and only if the tests are
fixed first. So the three tests below, their sizes and their rules are fixed now.

## What is frozen
- **Population:** signals with a signal day (Chicago) on or after 2026-10-01, after the agent model's cutoff, not superseded.
- **Measure:** 30-trading-day excess return vs SPY, net of the round-trip cost (0.3%, or 1.0% below $1M average daily dollar volume), entry at the next regular-session open after filing acceptance. Complete outcomes only.
- **Scorers:** baseline formula version 2 with the weights in `settings` at registration. Agent: Gemini 2.5 Flash. Every holdout signal is scored with **one** prompt version (see "Agent prompt"), never a mix. Design-set scores (prompt v1) are kept for reference.
- **Method for all tests:** whole calendar weeks are resampled with replacement (signals in a week move together), 2000 resamples, fixed seeds, one-sided 5% level. Each test is run **once**, at its fixed size, with no peeking at interim results as evidence. No multiple-testing correction: the three are separate hypotheses with separate decisions.
- **The holdout stays hidden** (Settings) until the design is frozen. Revealing it is a recorded, versioned setting change.

## H1 (gate 2): the top tier makes money
- **Hypothesis:** the mean 30-day net excess return of the top tier is greater than 0. Top tier = the top third by the baseline OR the top third by the agent, ranked within the holdout sample (a tie at a boundary shares weight).
- **Size:** the holdout has 90 or more signals scored by both with complete outcomes. All of them are used.
- **Decision:** supported if the one-sided 5% lower bound of the bootstrap distribution is above 0, otherwise not supported (gate 2 fails). The spec's fixed "agent score >= 70" is replaced by ranks because the agent's scores are bunched (a fixed 70 selected about two thirds of signals).
- **Expected timing:** early to mid 2027 (about 24 signals a month, plus about six weeks for a 30-day outcome).

## H2 (gate 3): promote the agent only if it out-ranks the baseline
- **Hypothesis:** Spearman correlation of the agent's score with the 30-day return minus the same for the baseline score is greater than 0. **One-sided.**
- **Size:** the earliest **300** holdout signals scored by both with complete outcomes. Fixed: no early stopping, and if more exist the later ones are ignored.
- **Decision:** supported if the one-sided 5% lower bound is above 0: **promote** the agent (it may inform decisions). Otherwise **not promoted**: the agent stays a shadow scorer that no decision uses, and Phase 2 proceeds on the baseline. Not promoted is the default until this test says otherwise.
- **The agent keeps running** as a shadow scorer either way (about $0.16 a month), so evidence keeps accumulating.
- **Power, stated up front:** on the design set the 95% interval for this difference was about +/-0.13 at n=332 (estimate +0.088, interval -0.045 to +0.221). A true difference of 0.1 would already be large. At n=300 the test is underpowered, and **an inconclusive result is the expected outcome, not a surprise.** The top-third tier comparison needs a gap of about 5 points at n=300, so it is not used to decide; it is reported descriptively only.
- **Expected timing:** late 2027.

## H3: offering-like clusters underperform
- **Hypothesis:** signals tagged `single_day_single_price` (every purchase on one day at one price, 3 or more insiders) have a lower mean 30-day net excess return than untagged signals. One-sided.
- **Size:** evaluated when the holdout has 30 or more tagged signals with complete outcomes (about 175 signals in total). All holdout signals with complete outcomes at that moment are used.
- **Decision:** supported if the one-sided 5% upper bound of (tagged minus rest) is below 0. Supported: excluding them becomes a documented default view (detection is unchanged). Not supported: the hypothesis is dropped.
- **Origin:** found by looking at design-set returns (about -6.4% vs +0.4% at 30 days), so it is a hypothesis until this test.

## Agent prompt v2 (frozen before the holdout is revealed)
Prompt v1 gives bunched scores (quartiles 65/75/82, 22 distinct values, 69% at 70 or above), which hurts every rank-based test. v2 asks for a spread scale. It is adopted **by score distribution alone, never by returns**, and the check never reads outcomes.
- **Sample:** 100 design-set signals chosen deterministically (every k-th by signal date), scored by a dry run that stores nothing and joins no outcomes.
- **Adoption criteria, all required:** at least 40 distinct scores; no more than 40% of scores at or above 70; interquartile range of at least 25 points; at least 98% of outputs valid.
- **If it fails:** revise the wording (again judged by distribution only), at most 3 rounds in total. If it still fails, holdout signals use v1 and this section says so.
- **Frozen:** whichever version is adopted, its file is never edited afterwards (a change is a new version). Every holdout signal is scored with it and only it. It is frozen before any holdout return is revealed.

## Deviations
Any departure from this document is recorded here, dated, with the reason, and in the work log. Results of these tests are reported as registered, including inconclusive ones.
