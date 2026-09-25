// Kept separate from worker/index.ts, which starts running as soon as it is imported.
export const JOB_NAMES = ['refresh-tickers', 'ingest-daily-index'] as const;
export type JobName = (typeof JOB_NAMES)[number];
