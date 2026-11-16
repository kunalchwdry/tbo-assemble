import { createRateLimiter } from './rate-limit';

/**
 * Per-instance burst limits for public routes (see rate-limit.ts: best effort, not a global limit).
 * Values are deliberately generous so normal interactive use is unaffected.
 */
export const routeLimiters = {
  /** /api/geocode: one venue lookup per page view; the provider itself is throttled to 1 request/second. */
  geocode: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  /** /api/procurement/plan: a 2,000-product plan takes seconds of CPU, so bursts are bounded per client. */
  plan: createRateLimiter({ limit: 20, windowMs: 60_000 }),
};

/** Test hook: clears every per-instance limiter. */
export function resetRouteLimiters() {
  for (const limiter of Object.values(routeLimiters)) limiter.reset();
}
