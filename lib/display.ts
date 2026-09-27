import { z } from 'zod';

export const DISPLAY_KEY = 'display';

export const displaySchema = z.object({
  /** Benchmark that pages compare against unless the URL says otherwise. */
  defaultBenchmark: z.enum(['SPY', 'IWM']).default('SPY'),
});

export type DisplaySettings = z.infer<typeof displaySchema>;
