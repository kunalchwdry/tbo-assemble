/**
 * next.config.ts headers override route-handler headers, and for the same key the LAST matching entry wins. These tests
 * pin the effective security headers per path so a config edit cannot silently weaken them. (Verified end to end against
 * `next start` in the security smoke test; this is the fast regression guard.)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import nextConfig from '../next.config';

async function effective(path: string) {
  const out: Record<string, string> = {};
  for (const entry of (await nextConfig.headers!()) ?? []) {
    const re = new RegExp(`^${entry.source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:path\*/g, '(?:/.*)?').replace(/:\w+/g, '[^/]+')}$`);
    if (re.test(path)) for (const h of entry.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

test('owner-scoped API and booking-link pages: no-store and no-referrer', async () => {
  for (const path of ['/api/v2/events', '/api/v2/booking-access/exchange', '/api/v2/public/events/x', '/booking/access', '/booking/abc']) {
    const h = await effective(path);
    assert.equal(h['referrer-policy'], 'no-referrer', path);
    assert.match(h['cache-control'] ?? '', /no-store/, path);
    assert.equal(h['x-content-type-options'], 'nosniff', path);
  }
});

test('legacy private routes stay no-store; every path keeps nosniff and a referrer policy', async () => {
  for (const path of ['/api/events', '/api/guests/x', '/api/bookings/x', '/event/x', '/dashboard', '/secure-account']) assert.match((await effective(path))['cache-control'] ?? '', /no-store/, path);
  for (const path of ['/', '/inventory', '/api/geocode']) {
    const h = await effective(path);
    assert.equal(h['x-content-type-options'], 'nosniff', path);
    assert.ok(['same-origin', 'no-referrer', 'strict-origin-when-cross-origin'].includes(h['referrer-policy']), path);
  }
});
