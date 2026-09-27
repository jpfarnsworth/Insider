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
- **Frozen the moment it first resolves, never recomputed.** The instant a test's population first reaches its registered
  size, its exact signal list, estimate, interval and verdict are written to `prereg_results` and read back verbatim from
  then on -- the app never recalculates it, however much more holdout data arrives later. This is not optional: without
  it, a test that kept including newly-matured signals would be a running number you could watch drift and stop on
  when it looked good (the classic optional-stopping problem, which would undo the whole point of pre-registering). It
  also guards against late corrections -- a Form 4 filed months late with an earlier transaction date (this has
  happened: TRIN, 221 days late), or a price later restated by a split -- changing which signals belong to an
  already-decided test.
- **The holdout stays hidden** (Settings) until the design is frozen. Revealing it is a recorded, versioned setting change.

## H1 (gate 2): the baseline's top tier makes money
- **Hypothesis:** the mean 30-day net excess return of the baseline's top third is greater than 0, ranked within the holdout sample (a tie at a boundary shares weight). **Baseline only, by design**: the baseline scores every signal as soon as it's created, so H1 does not depend on the agent and keeps filling up even if agent scoring stalls.
- **Size:** the holdout has 90 or more signals with a complete outcome. All of them are used, whether or not the agent has scored them.
- **Decision:** supported if the one-sided 5% lower bound of the bootstrap distribution is above 0, otherwise not supported (gate 2 fails). The spec's fixed "agent score >= 70 or baseline top third" union is replaced by baseline rank alone (see the 2026-09-27 deviation below): a union tier makes the gate depend on the agent for no reason, and the agent's scores are bunched anyway (a fixed 70 selected about two thirds of signals).
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

## Prompt v2 round log
Each round scored the same 100 design-set signals (every 5th of 526, by signal date). Nothing was stored and no returns were read.

| Round | Wording | Distinct | Quartiles | IQR | Share >= 70 | Valid | Result |
|---|---|---|---|---|---|---|---|
| v1 (reference) | ordinary = 50, "reserve above 80" | 22 | 65 / 75 / 82 | 17 | 69% | 100% | (the problem) |
| 2026-09-27, round 1 | "use the whole scale", anchors, avoid round numbers | 19 | 68 / 73 / 78 | 10 | 69% | 100% | Not adopted |
| 2026-09-27, round 2 | percentile-rank framing with five described bands | 17 | 68 / 78 / 82 | 14 | 73% | 100% | Not adopted |

**Status (2026-09-27): v2 is not adopted, and holdout signals keep using v1.** Two of the three allowed rounds are used. A third round may still be run later; the holdout stays hidden, so this costs nothing in evidence. If a round passes, v2 is frozen and every holdout signal is re-scored with it (v1 evaluations are kept, never overwritten), so the holdout never mixes versions. If round 3 also fails, v1 stays for good.

Two things noted while deciding, neither of which changes the registered criteria:
- The model scores nearly every cluster as good whatever the framing, so the spread criteria (share at 70 or above, IQR) may be unreachable by wording alone. Rank tests are unaffected by the scale of the scores; what hurts them is ties (few distinct values). The registered criteria stay as written; relaxing them would be a deviation recorded here, with its reason.
- v1 already shows the larger rank-correlation edge on the design set (agent minus baseline +0.110, 90% interval +0.016 to +0.205, 473 signals; descriptive, not evidence). Adopting v2 would make H2 test a scorer with no track record, so a v2 that passes on distribution should still be judged only by the registered process.

## Revealing the holdout
Each test (H1, H2, H3) computes and shows its own result automatically once it reaches its registered sample size --
**no reveal needed**. Reveal controls something narrower: whether *individual* holdout signals become visible
(their own page, the signals list, CSV export, MCP), which stays masked (no outcomes at all) until you flip it.

- **Locked by default.** Revealing is refused unless all three tests have resolved (supported or not supported), or
  you give a written reason of 20+ characters, recorded verbatim next to which tests were still pending.
- **Audited.** The moment reveal flips false to true, the app records who and when, alongside the setting's own
  versioned history.
- **Used up.** Once revealed, that holdout window is spent: it has been looked at. Any new idea that comes from
  digging into it -- a new filter, a new tag, a new prompt version -- is tested on a **fresh** holdout window that
  starts on or after the reveal date, registered the same way this one was. Changing `from` while already revealed
  is refused unless `reveal` is turned back off in the same save, so a new window can't be opened under the old
  audit trail.
- **The start date itself is locked**, as of this registration (2026-09-27), not just once the window opens. Moving
  it at all -- earlier, later, before or after any reveal -- needs the same 20+ character written reason, logged
  permanently with a timestamp and who made it (`holdout.fromChanges`, shown on the Settings page). Moving it
  without a reason would let a look at design-set results quietly decide which signals count as holdout.
- **An early-reveal reason is shown next to the test results**, not only in Settings: the Performance page's
  pre-registered-tests panel and the MCP `get_performance` tool both carry the reveal timestamp, who did it, which
  tests were still pending, and the reason verbatim, so anyone reading a result later can see whether the holdout
  was opened early and why.

## Deviations
Any departure from this document is recorded here, dated, with the reason, and in the work log. Results of these tests are reported as registered, including inconclusive ones.

### 2026-09-27: H1 decoupled from the agent
As first written, H1's top tier was the union of the baseline's top third OR the agent's top third, and its
population was "signals scored by both." That makes a baseline-only question ("do the top-ranked signals beat
SPY?") depend on the agent continuing to score signals: if shadow scoring stalled (a lapsed API key, a quota,
a code change), H1 would silently stop accumulating. The union/shared-signals rule was meant for head-to-head
comparisons (H2), not for H1. **Fixed before any holdout signal existed**: H1's top tier is now the baseline's
top third alone, over every holdout signal with a matured outcome, independent of the agent. The registered
size (90) and decision rule (one-sided 5%) are unchanged.
