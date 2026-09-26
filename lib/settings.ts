import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '@/lib/db';
import { settings } from '@/db/schema';

/**
 * Reads a JSON setting and fills anything missing from the schema's defaults.
 * A missing or malformed row gives the defaults, so a bad edit can't stop a job.
 */
export async function getSetting<S extends z.ZodType>(db: Db, key: string, schema: S): Promise<z.output<S>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  const parsed = schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}
