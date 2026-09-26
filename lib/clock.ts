/** The current time, behind a function so server components can read it and tests can stub it. */
export const nowMs = (): number => Date.now();
