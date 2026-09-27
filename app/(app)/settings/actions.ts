'use server';

import { spawn } from 'node:child_process';
import { revalidatePath, updateTag } from 'next/cache';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/require-user';
import { AGENT_LIMITS_KEY, agentLimitsSchema } from '@/lib/agent/models';
import { previewClusterRule } from '@/lib/clusters/store';
import { CLUSTER_RULE_KEY, clusterRuleSchema } from '@/lib/clusters/rule';
import { chicagoToday } from '@/lib/edgar/dates';
import { DISPLAY_KEY, displaySchema } from '@/lib/display';
import { FLAGS_KEY, flagsSchema, getFlags } from '@/lib/flags';
import { COSTS_KEY, costsSchema } from '@/lib/market/costs';
import { sendTelegram, telegramConfigured } from '@/lib/notify/telegram';
import { NOTIFICATIONS_KEY, notificationsSchema } from '@/lib/notify/settings';
import { BASELINE_WEIGHTS_KEY, baselineWeightsSchema } from '@/lib/scoring/baseline';
import { HOLDOUT_KEY, canChangeFrom, holdoutSchema } from '@/lib/research/holdout';
import { getCachedSignalFactsForTests } from '@/lib/analytics/cache';
import { canReveal, evaluatePrereg } from '@/lib/analytics/prereg';
import type { ViewOptions } from '@/lib/analytics/facts';
import { getSetting, saveSetting } from '@/lib/settings';
import { ANALYTICS_TAG } from '@/lib/analytics/cache';
import type { FormState } from './state';

const num = (fd: FormData, name: string): number => {
  const raw = String(fd.get(name) ?? '').trim();
  return raw === '' ? NaN : Number(raw);
};
const nums = (fd: FormData, names: string[]) => Object.fromEntries(names.map((n) => [n, num(fd, n)]));
const checked = (fd: FormData, name: string) => fd.get(name) === 'on';

async function save<S extends z.ZodType>(key: string, schema: S, input: unknown, ok: (version: number) => string): Promise<FormState> {
  const res = await saveSetting(db, key, schema, input);
  if (!res.ok) return { status: 'error', message: res.error };
  revalidatePath('/settings');
  // Everything downstream reads these settings, so cached pages must not keep old numbers. This
  // process (the web server) can revalidate the analytics cache directly; a worker CLI run cannot,
  // and falls back to that cache's own short TTL (lib/analytics/cache.ts).
  revalidatePath('/', 'layout');
  updateTag(ANALYTICS_TAG);
  return { status: 'ok', message: res.changed ? ok(res.version) : 'No changes to save.' };
}

const RULE_FIELDS = ['windowDays', 'minInsiders', 'minTotalValue', 'minPerInsiderValue', 'minPrice', 'minMarketCap'];
const ruleInput = (fd: FormData) => ({ ...nums(fd, RULE_FIELDS), excludeTenPctOnly: checked(fd, 'excludeTenPctOnly') });

/** Saves the cluster rule, or (intent "secondary") previews how many signals it would produce. */
export async function clusterRuleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  if (fd.get('intent') === 'secondary') {
    const parsed = clusterRuleSchema.safeParse(ruleInput(fd));
    if (!parsed.success) return { status: 'error', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    const preview = await previewClusterRule(db, parsed.data, chicagoToday());
    return { status: 'ok', message: 'Preview only, nothing was saved.', preview };
  }
  return save(CLUSTER_RULE_KEY, clusterRuleSchema, ruleInput(fd), (v) => `Saved as revision ${v}. New detections use it; run detect-clusters on the System page to apply it to history. Existing signals stay.`);
}

export async function baselineWeightsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  if (fd.get('intent') === 'secondary') {
    // Runs the same CLI the scheduler uses, detached (workers share this server).
    spawn('npm', ['run', 'worker', '--', 'score-baseline', '--force'], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref();
    revalidatePath('/system');
    return { status: 'ok', message: 'Re-scoring every signal with the saved weights. Progress is on the System page.' };
  }
  return save(
    BASELINE_WEIGHTS_KEY,
    baselineWeightsSchema,
    nums(fd, ['insiders', 'valueVsMarketCap', 'seniority', 'holdingsIncrease', 'priceContext', 'sellPenaltyMax']),
    (v) => `Saved as revision ${v}. New signals use these weights; existing scores keep theirs until you re-score.`,
  );
}

export async function costsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  return save(COSTS_KEY, costsSchema, nums(fd, ['roundTripPct', 'illiquidRoundTripPct', 'illiquidDollarVolume']), (v) => `Saved as revision ${v}. Net returns everywhere use it.`);
}

export async function displayAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  return save(DISPLAY_KEY, displaySchema, { defaultBenchmark: String(fd.get('defaultBenchmark') ?? '') }, (v) => `Saved as revision ${v}.`);
}

export async function agentLimitsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  return save(
    AGENT_LIMITS_KEY,
    agentLimitsSchema,
    nums(fd, ['dailyCap', 'monthlyTokenBudget', 'inputUsdPerMTok', 'outputUsdPerMTok']),
    (v) => `Saved as revision ${v}. Applies from the next evaluation.`,
  );
}

export async function flagsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const current = await getFlags(db);
  const next = { ...current, agent_scoring: checked(fd, 'agent_scoring'), early_watch_clusters: checked(fd, 'early_watch_clusters') };
  return save(FLAGS_KEY, flagsSchema, next, (v) => `Saved as revision ${v}.`);
}

/** Saves the alert rules and the `notifications` flag together, or sends a test message. */
export async function notificationsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  if (fd.get('intent') === 'secondary') {
    if (!telegramConfigured()) return { status: 'error', message: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local, then restart the app.' };
    const res = await sendTelegram('✅ <b>Insider Signals</b>: test notification received.');
    return res.ok ? { status: 'ok', message: 'Test message sent.' } : { status: 'error', message: res.error };
  }
  const flagRes = await saveSetting(db, FLAGS_KEY, flagsSchema, { ...(await getFlags(db)), notifications: checked(fd, 'notifications') });
  if (!flagRes.ok) return { status: 'error', message: flagRes.error };
  return save(
    NOTIFICATIONS_KEY,
    notificationsSchema,
    { minScore: num(fd, 'minScore'), signalAlerts: checked(fd, 'signalAlerts'), jobFailures: checked(fd, 'jobFailures') },
    (v) => `Saved as revision ${v}.`,
  ).then((s) => (s.status === 'ok' && s.message === 'No changes to save.' && flagRes.changed ? { ...s, message: 'Saved.' } : s));
}


/** Saves the holdout start date and whether it is revealed. Revealing is a versioned change, so it leaves a record. */
/**
 * Saves the holdout. Each pre-registered test (lib/analytics/prereg.ts) shows its own result as soon
 * as it reaches its registered size, with no reveal needed, so this action never has to unblind
 * anything to make a test resolve. Setting `reveal` only lifts the mask on individual holdout signals,
 * and is locked until every test has resolved unless a written reason (20+ characters) is given, which
 * is recorded verbatim. Changing `from` while already revealed would silently start a new holdout
 * under the old audit trail, so it is refused: reveal must be turned off in the same save to start a
 * fresh window.
 */
export async function holdoutAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const from = String(fd.get('from') ?? '');
  const wantsReveal = checked(fd, 'reveal');
  const abandonReason = String(fd.get('abandonReason') ?? '').trim() || null;
  const fromChangeReason = String(fd.get('fromChangeReason') ?? '').trim() || null;

  const current = await getSetting(db, HOLDOUT_KEY, holdoutSchema);
  if (current.reveal && from !== current.from && wantsReveal) {
    return { status: 'error', message: 'This holdout is already revealed. To start a new one, set a later date and uncheck "Reveal" in the same save.' };
  }
  // The start date is locked as soon as it is registered (docs/preregistration.md): changing it needs
  // the same written-reason bar as an early reveal, logged permanently, whether or not reveal is involved.
  const dateCheck = canChangeFrom(current.from, from, fromChangeReason);
  if (!dateCheck.ok) return { status: 'error', message: dateCheck.error };
  const fromChanges =
    from === current.from
      ? current.fromChanges
      : [...current.fromChanges, { at: new Date().toISOString(), by: user.email ?? null, from: current.from, to: from, reason: fromChangeReason! }];

  let revealedAt = current.revealedAt;
  let revealedBy = current.revealedBy;
  let abandonedTests = current.abandonedTests;
  let finalAbandonReason = current.abandonReason;

  if (wantsReveal && !current.reveal) {
    // Flipping false -> true right now: check the registered tests before allowing it.
    const [costs, testFacts] = await Promise.all([getSetting(db, COSTS_KEY, costsSchema), getCachedSignalFactsForTests()]);
    const view: ViewOptions = { bench: 'SPY', net: true, scope: 'post', costs };
    const results = evaluatePrereg(testFacts, view);
    const check = canReveal(results, abandonReason);
    if (!check.ok) return { status: 'error', message: check.error };
    revealedAt = new Date().toISOString();
    revealedBy = user.email ?? null;
    abandonedTests = check.pending;
    finalAbandonReason = check.pending.length ? abandonReason : null;
  } else if (!wantsReveal) {
    // Turning reveal off (or it already was off): a fresh audit trail starts the next time it flips on.
    revealedAt = null;
    revealedBy = null;
    abandonedTests = [];
    finalAbandonReason = null;
  }

  return save(
    HOLDOUT_KEY,
    holdoutSchema,
    { from, reveal: wantsReveal, revealedAt, revealedBy, abandonReason: finalAbandonReason, abandonedTests, fromChanges },
    (v) =>
      wantsReveal && !current.reveal
        ? `Revealed as revision ${v}. Every page, export and MCP tool now shows holdout signals.`
        : from !== current.from
          ? `Saved as revision ${v}. Start date changed and logged.`
          : `Saved as revision ${v}.`,
  );
}
