// Dry run for the prompt-v2 adoption check (docs/preregistration.md). Scores a deterministic sample of
// design-set signals with the chosen prompt and prints ONLY the distribution of scores: it stores nothing
// and never reads or joins returns, so the choice of prompt cannot be steered by outcomes.
//   npm run prompt:distribution -- [v1|v2] [--n=100]
import { and, asc, ne, sql } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { signals } from '@/db/schema';
import { createGeminiProvider, resolveGeminiKey } from '@/lib/agent/gemini';
import { AGENT_MODEL } from '@/lib/agent/models';
import { evaluateBundle } from '@/lib/agent/evaluate';
import { PROMPTS } from '@/lib/agent/prompts';
import { loadBundle } from '@/lib/agent/store';
import { createEdgarClient, resolveUserAgent } from '@/lib/edgar/client';
import { loadHoldoutStart } from '@/lib/research/holdout';

const CRITERIA = { minDistinct: 40, maxShareAt70: 0.4, minIqr: 25, minValid: 0.98 } as const;

const version = (process.argv[2] === 'v1' ? 'v1' : 'v2') as 'v1' | 'v2';
const n = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 100);

async function main() {
  const holdoutFrom = await loadHoldoutStart(db);
  const rows = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(ne(signals.status, 'superseded'), sql`${signals.signalAt}::date > date '2025-01-31'`, sql`${signals.signalAt} < ${holdoutFrom}::date`))
    .orderBy(asc(signals.signalAt), asc(signals.id));
  const step = Math.max(1, Math.floor(rows.length / n));
  const sample = rows.filter((_, i) => i % step === 0).slice(0, n);
  console.log(`prompt ${version}: ${sample.length} design-set signals (every ${step}th of ${rows.length}), nothing is stored, no returns are read`);

  const provider = createGeminiProvider({ apiKey: resolveGeminiKey(), model: AGENT_MODEL.id });
  const edgar = createEdgarClient({ userAgent: resolveUserAgent() });
  const scores: number[] = [];
  let invalid = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const s of sample) {
    const bundle = await loadBundle(db, edgar, s.id);
    if (!bundle) continue;
    const r = await evaluateBundle(provider, bundle, PROMPTS[version]);
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    if (r.status === 'ok') scores.push(r.output.score);
    else invalid++;
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const distinct = new Set(scores).size;
  const shareAt70 = scores.filter((x) => x >= 70).length / Math.max(1, scores.length);
  const iqr = q(0.75) - q(0.25);
  const valid = scores.length / Math.max(1, scores.length + invalid);
  const checks = {
    [`distinct >= ${CRITERIA.minDistinct}`]: distinct >= CRITERIA.minDistinct,
    [`share >= 70 is <= ${CRITERIA.maxShareAt70 * 100}%`]: shareAt70 <= CRITERIA.maxShareAt70,
    [`IQR >= ${CRITERIA.minIqr}`]: iqr >= CRITERIA.minIqr,
    [`valid >= ${CRITERIA.minValid * 100}%`]: valid >= CRITERIA.minValid,
  };
  console.log({ scored: scores.length, invalid, distinct, quartiles: [q(0.25), q(0.5), q(0.75)], iqr, shareAt70: Number(shareAt70.toFixed(3)), min: sorted[0], max: sorted.at(-1), tokensIn, tokensOut });
  console.log('histogram (deciles):', Array.from({ length: 10 }, (_, d) => `${d * 10}s:${scores.filter((x) => Math.min(9, Math.floor(x / 10)) === d).length}`).join(' '));
  console.log('adoption checks:', checks, Object.values(checks).every(Boolean) ? '=> ALL PASS' : '=> NOT ADOPTED');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
