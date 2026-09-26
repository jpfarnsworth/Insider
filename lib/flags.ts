import { z } from 'zod';
import type { Db } from '@/lib/db';
import { getSetting } from '@/lib/settings';

// Spec §10. Stored in `settings` for now; PostHog can take over behind the same call.
export const FLAGS_KEY = 'feature_flags';

export const flagsSchema = z.object({
  intraday_polling: z.boolean().default(false),
  agent_scoring: z.boolean().default(true),
  early_watch_clusters: z.boolean().default(true),
  notifications: z.boolean().default(false),
  paper_trading: z.boolean().default(false),
});

export type Flags = z.infer<typeof flagsSchema>;

export function getFlags(db: Db): Promise<Flags> {
  return getSetting(db, FLAGS_KEY, flagsSchema);
}
