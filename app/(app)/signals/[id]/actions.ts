'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { createGeminiProvider, resolveGeminiKey } from '@/lib/agent/gemini';
import { stopReason } from '@/lib/agent/limits';
import { AGENT_MODEL } from '@/lib/agent/models';
import { agentUsage, evaluateSignal, loadAgentLimits } from '@/lib/agent/store';
import { requireUser } from '@/lib/auth/require-user';
import { createEdgarClient, resolveUserAgent } from '@/lib/edgar/client';
import { getFlags } from '@/lib/flags';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Re-score with current prompt" (spec §5.2): a NEW evaluation row, never an overwrite.
 * The monthly token budget still applies; the daily cap governs the scheduled job, not a
 * deliberate click. A failed attempt is stored and shown in the history.
 */
export async function rescoreSignal(formData: FormData) {
  await requireUser();
  const signalId = String(formData.get('signalId'));
  if (!UUID.test(signalId)) throw new Error('Invalid signal');
  if (!(await getFlags(db)).agent_scoring) throw new Error('Agent scoring is turned off');

  const [limits, usage] = await Promise.all([loadAgentLimits(db), agentUsage(db)]);
  if (stopReason(usage, limits, { ignoreDailyCap: true })) throw new Error('The monthly token budget is used up');

  const provider = createGeminiProvider({ apiKey: resolveGeminiKey(), model: AGENT_MODEL.id });
  const edgar = createEdgarClient({ userAgent: resolveUserAgent() });
  await evaluateSignal(db, provider, edgar, signalId);
  revalidatePath(`/signals/${signalId}`);
  revalidatePath('/signals');
  revalidatePath('/system');
}
