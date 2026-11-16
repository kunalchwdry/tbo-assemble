/**
 * Fixed-window request limiter, in memory, per server instance.
 *
 * It bounds bursts from one client on one instance (for example a script hammering an expensive route). It is NOT a
 * global limit: serverless platforms run several instances and recycle them, so each instance counts separately.
 * Use a shared store (or the platform's firewall rules) for a hard global limit.
 */
export type RateLimitDecision = { allowed: boolean; remaining: number; limit: number; retryAfterSeconds: number };

export type RateLimiter = {
  check(key: string, now?: number): RateLimitDecision;
  reset(): void;
  readonly size: number;
};

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(key: string, now: number = Date.now()): RateLimitDecision {
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (w) windows.delete(key);
        w = { start: now, count: 0 };
        windows.set(key, w);
        // Bound memory: drop the oldest windows first (Map keeps insertion order).
        while (windows.size > maxKeys) windows.delete(windows.keys().next().value as string);
      }
      w.count++;
      const allowed = w.count <= limit;
      return { allowed, remaining: Math.max(0, limit - w.count), limit, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
    },
    reset() { windows.clear(); },
    get size() { return windows.size; },
  };
}

/**
 * Best-effort client key from proxy headers. The first `x-forwarded-for` hop is set by the hosting platform's edge on
 * Vercel; elsewhere it can be spoofed, so treat the key as a rate-limit bucket, never as an identity.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
  return ip.slice(0, 64);
}

export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  const h: Record<string, string> = { 'X-RateLimit-Limit': String(d.limit), 'X-RateLimit-Remaining': String(d.remaining) };
  if (!d.allowed) h['Retry-After'] = String(d.retryAfterSeconds);
  return h;
}
