/** Plan API burst limit (per instance, per client bucket): only valid requests that reach the optimiser count. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { opportunities } from '../src/lib/procurement-core';
import { POST } from '../src/app/api/procurement/plan/route';
import { resetRouteLimiters, routeLimiters } from '../src/lib/route-limits';

const o = opportunities[0];
const item = { id: o.id, name: o.name, destination: o.destination, kind: o.kind, period: o.period, buy: o.buy, referencePrice: o.referencePrice, capacity: o.capacity, bookings: o.bookings, searches: o.searches, conversion: o.conversion, seasonal: o.seasonal, signal: o.signal, cancellations: o.cancellations, volatility: o.volatility, soldOut: o.soldOut, integration: o.integration, timing: o.timing };
const call = (ip: string, body: Record<string, unknown> = { items: [item], budget: 100_000, risk: 0.2, asOf: '2026-11-16' }) =>
  POST(new Request('http://localhost/api/procurement/plan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) }));

test('the 21st valid plan request in a minute from one client gets 429 with Retry-After; others are unaffected', async () => {
  resetRouteLimiters();
  const limit = routeLimiters.plan.check('probe').limit; routeLimiters.plan.reset();
  assert.equal(limit, 20);
  for (let i = 0; i < limit; i++) assert.equal((await call('203.0.113.9')).status, 200, `request ${i + 1}`);
  const blocked = await call('203.0.113.9');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
  assert.equal(blocked.headers.get('X-RateLimit-Remaining'), '0');
  assert.match((await blocked.json()).error, /Too many planning requests/);
  assert.equal((await call('198.51.100.7')).status, 200, 'a different client has its own bucket');
  resetRouteLimiters();
});

test('invalid requests are rejected without consuming the burst budget', async () => {
  resetRouteLimiters();
  for (let i = 0; i < 30; i++) assert.equal((await call('203.0.113.10', { items: [], budget: 1, risk: 0, asOf: '2026-11-16' })).status, 400);
  assert.equal((await call('203.0.113.10')).status, 200);
  resetRouteLimiters();
});
