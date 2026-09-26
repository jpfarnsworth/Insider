import { z } from 'zod';

// Spec §4.1. Stored in `settings` under CLUSTER_RULE_KEY; bump CLUSTER_RULE_VERSION
// whenever detection logic (not just a parameter) changes.
export const CLUSTER_RULE_VERSION = 1;
export const CLUSTER_RULE_KEY = 'cluster_rule';

export const clusterRuleSchema = z.object({
  windowDays: z.number().int().min(1).default(14),
  minInsiders: z.number().int().min(1).default(3),
  minTotalValue: z.number().min(0).default(250_000),
  minPerInsiderValue: z.number().min(0).default(10_000),
  excludeTenPctOnly: z.boolean().default(true),
  minPrice: z.number().min(0).default(2),
  minMarketCap: z.number().min(0).default(50_000_000),
});

export type ClusterRule = z.infer<typeof clusterRuleSchema>;

export const DEFAULT_CLUSTER_RULE: ClusterRule = clusterRuleSchema.parse({});
