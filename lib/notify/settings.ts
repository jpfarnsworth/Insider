import { z } from 'zod';

export const NOTIFICATIONS_KEY = 'notifications';

// The master switch is the `notifications` feature flag (spec §10); these say what to send.
export const notificationsSchema = z.object({
  /** Alert when the baseline or agent score reaches this. */
  minScore: z.number().min(0).max(100).default(70),
  signalAlerts: z.boolean().default(true),
  jobFailures: z.boolean().default(true),
  /** A job that "succeeds" while ingesting or producing nothing (a changed feed, a regression) is a quieter failure than an error (lib/notify/freshness.ts). */
  pipelineStale: z.boolean().default(true),
});

export type NotificationSettings = z.infer<typeof notificationsSchema>;
