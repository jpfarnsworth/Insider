// Failed-login throttle, keyed by client IP. In-memory, so it resets when the
// server restarts and isn't shared across processes; enough for a single-user
// app on one server. Not keyed by email, so a stranger can't lock the owner out.
export function createLoginLimiter({
  maxFailures = 5,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
}: { maxFailures?: number; windowMs?: number; now?: () => number } = {}) {
  const failures = new Map<string, number[]>();

  function recent(key: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  }

  return {
    isBlocked: (key: string) => recent(key).length >= maxFailures,
    recordFailure(key: string) {
      failures.set(key, [...recent(key), now()]);
    },
    reset: (key: string) => void failures.delete(key),
  };
}
