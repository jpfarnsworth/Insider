import { desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '@/lib/db';
import { settings, settingVersions } from '@/db/schema';

/**
 * Reads a JSON setting and fills anything missing from the schema's defaults.
 * A missing or malformed row gives the defaults, so a bad edit can't stop a job.
 */
export async function getSetting<S extends z.ZodType>(db: Db, key: string, schema: S): Promise<z.output<S>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  const parsed = schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/** The latest saved revision of a setting; 0 while it has only ever been the defaults. */
export async function getRevision(db: Db, key: string): Promise<number> {
  const [row] = await db
    .select({ v: sql<number>`coalesce(max(${settingVersions.version}), 0)::int` })
    .from(settingVersions)
    .where(eq(settingVersions.key, key));
  return row?.v ?? 0;
}

export interface SavedVersion {
  version: number;
  value: unknown;
  createdAt: Date;
}

export function listVersions(db: Db, key: string, limit = 5): Promise<SavedVersion[]> {
  return db
    .select({ version: settingVersions.version, value: settingVersions.value, createdAt: settingVersions.createdAt })
    .from(settingVersions)
    .where(eq(settingVersions.key, key))
    .orderBy(desc(settingVersions.version))
    .limit(limit);
}

export type SaveResult<T> = { ok: true; value: T; version: number; changed: boolean } | { ok: false; error: string };

/**
 * Validates and stores a setting. A save that changes nothing is a no-op; a real change updates
 * `settings` and appends a numbered row to `setting_versions` in one transaction (spec §9.10).
 */
export async function saveSetting<S extends z.ZodType>(db: Db, key: string, schema: S, input: unknown): Promise<SaveResult<z.output<S>>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ') };
  }
  const value = parsed.data;
  return db.transaction(async (tx) => {
    // Serialise concurrent saves of the same key so version numbers can't collide.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const current = await getSetting(tx as unknown as Db, key, schema);
    const version = await getRevision(tx as unknown as Db, key);
    if (JSON.stringify(current) === JSON.stringify(value)) return { ok: true as const, value, version, changed: false };
    await tx
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(settingVersions).values({ key, version: version + 1, value });
    return { ok: true as const, value, version: version + 1, changed: true };
  });
}
