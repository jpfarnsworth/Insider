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
import { HOLDOUT_KEY, holdoutSchema } from '@/lib/research/holdout';
import { saveSetting } from '@/lib/settings';
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
export async function holdoutAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  return save(
    HOLDOUT_KEY,
    holdoutSchema,
    { from: String(fd.get('from') ?? ''), reveal: checked(fd, 'reveal') },
    (v) => `Saved as revision ${v}. Every page, export and MCP tool follows it.`,
  );
}
