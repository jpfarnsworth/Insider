import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { preregResults } from '@/db/schema';

export type TestId = 'H1' | 'H2' | 'H3';

export interface FrozenResult {
  testId: TestId;
  frozenAt: Date;
  n: number;
  signalIds: string[];
  estimate: number;
  lo: number;
  hi: number;
  status: 'supported' | 'not_supported';
  bootstraps: number;
  seed: number;
}

export type FreezeInput = Omit<FrozenResult, 'frozenAt'>;

/**
 * Where a pre-registered test's result lives once it resolves. `freeze` must be first-writer-wins: if
 * two requests both notice the threshold crossed at once, only one insert succeeds and both callers end
 * up returning that same row, never two different numbers for the same test.
 */
export interface PreregStore {
  get(testId: TestId): Promise<FrozenResult | null>;
  freeze(input: FreezeInput): Promise<FrozenResult>;
}

const toFrozen = (row: typeof preregResults.$inferSelect): FrozenResult => ({
  testId: row.testId as TestId,
  frozenAt: row.createdAt,
  n: row.n,
  signalIds: row.signalIds,
  estimate: Number(row.estimate),
  lo: Number(row.lo),
  hi: Number(row.hi),
  status: row.status,
  bootstraps: row.bootstraps,
  seed: row.seed,
});

/** The real store: a row, once inserted, is never updated. */
export function drizzlePreregStore(db: Db): PreregStore {
  return {
    async get(testId) {
      const [row] = await db.select().from(preregResults).where(eq(preregResults.testId, testId)).limit(1);
      return row ? toFrozen(row) : null;
    },
    async freeze(input) {
      await db
        .insert(preregResults)
        .values({
          testId: input.testId,
          n: input.n,
          signalIds: input.signalIds,
          estimate: input.estimate.toString(),
          lo: input.lo.toString(),
          hi: input.hi.toString(),
          status: input.status,
          bootstraps: input.bootstraps,
          seed: input.seed,
        })
        .onConflictDoNothing({ target: preregResults.testId });
      const [row] = await db.select().from(preregResults).where(eq(preregResults.testId, input.testId)).limit(1);
      return toFrozen(row!);
    },
  };
}

/** An in-memory store for tests: same first-writer-wins contract, no database. */
export function memoryPreregStore(): PreregStore {
  const rows = new Map<TestId, FrozenResult>();
  return {
    async get(testId) {
      return rows.get(testId) ?? null;
    },
    async freeze(input) {
      if (!rows.has(input.testId)) rows.set(input.testId, { ...input, frozenAt: new Date() });
      return rows.get(input.testId)!;
    },
  };
}
