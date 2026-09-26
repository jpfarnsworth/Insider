import type { Db } from '@/lib/db';
import { createGeminiProvider, resolveGeminiKey } from '@/lib/agent/gemini';
import { AGENT_MODEL } from '@/lib/agent/models';
import { runAgentScoring } from '@/lib/agent/store';
import { createEdgarClient, resolveUserAgent } from '@/lib/edgar/client';
import { getFlags } from '@/lib/flags';
import type { JobResult } from '../run-job';

/**
 * Agent scoring (Gemini 2.5 Flash), subject to the daily cap and monthly
 * token budget (spec §5.2, §8). Behind the `agent_scoring` flag.
 */
export async function scoreAgentJob(db: Db, opts: { limit?: number } = {}): Promise<JobResult> {
  if (!(await getFlags(db)).agent_scoring) return { itemsProcessed: 0, meta: { skipped: 'agent_scoring flag is off' } };

  const provider = createGeminiProvider({ apiKey: resolveGeminiKey(), model: AGENT_MODEL.id });
  const edgar = createEdgarClient({ userAgent: resolveUserAgent() });
  const stats = await runAgentScoring(db, provider, edgar, opts);
  return { itemsProcessed: stats.evaluated, meta: { ...stats, model: AGENT_MODEL.id } };
}
