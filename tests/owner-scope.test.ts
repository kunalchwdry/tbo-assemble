/**
 * Owner-scoped (v2) access: policy, allowlists, request guards and capability helpers, with local mocks only.
 * No database, no Supabase, no network; synthetic ids. The same handlers run against an isolated PostgreSQL
 * database in tests/owner-scope-db.test.ts.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decide, publicEventView, bookingHolderView, type Principal, type Role } from '../src/lib/access/event-access';
import { validateEventPatch, validateGuestCreate, validateGuestPatch, validateStatusChange, canTransition, readJsonBody, EVENT_STATUS_TRANSITIONS } from '../src/lib/access/validate';
import { sameOriginCheck, audit, pseudonym } from '../src/lib/access/request-guards';
import { hashToken, newToken, readSessionCookie, sessionCookie, TOKEN_FORMAT } from '../src/lib/access/booking-capability';
import { getEventHandler, patchEventHandler, listEventsHandler, getBookingHandler, type OwnerScopeDeps } from '../src/lib/access/owner-scope-handlers';
import type { OwnerRepo } from '../src/lib/access/owner-repo';
import type { CapabilityStore } from '../src/lib/access/booking-capability';
import { readFileSync } from 'node:fs';

const ALICE = '11111111-1111-4111-8111-111111111111';
const EV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = (id = ALICE): Principal => ({ kind: 'user', authUserId: id });
const anon: Principal = { kind: 'anonymous' };

test('policy: anonymous gets 401 on every owner action, whether or not the event exists', () => {
  for (const action of ['event:list', 'event:read', 'event:write', 'guest:list', 'guest:write', 'booking:access-admin'] as const) {
    for (const exists of [true, false]) assert.deepEqual(decide(action, anon, { exists, role: 'owner' }), { allow: false, status: 401, reason: 'Sign in to manage events.' });
  }
});

test('policy: role matrix (no role or missing -> 404; viewer write -> 403; editor cannot administer access)', () => {
  const cases: [string, Role | null, number | 'allow'][] = [
    ['event:read', 'viewer', 'allow'], ['event:read', 'editor', 'allow'], ['event:read', 'owner', 'allow'], ['event:read', null, 404],
    ['event:write', 'viewer', 403], ['event:write', 'editor', 'allow'], ['event:write', 'owner', 'allow'], ['event:write', null, 404],
    ['guest:list', 'viewer', 'allow'], ['guest:write', 'viewer', 403], ['guest:write', 'editor', 'allow'], ['guest:write', null, 404],
    ['booking:access-admin', 'owner', 'allow'], ['booking:access-admin', 'editor', 403], ['booking:access-admin', 'viewer', 403], ['booking:access-admin', null, 404],
  ];
  for (const [action, role, want] of cases) {
    const d = decide(action as Parameters<typeof decide>[0], user(), { exists: true, role });
    assert.equal(d.allow ? 'allow' : d.status, want, `${action} as ${role}`);
  }
  // A missing resource is indistinguishable from someone else's.
  assert.deepEqual(decide('event:read', user(), { exists: false, role: null }), decide('event:read', user(), { exists: true, role: null }));
});

test('policy: bookings need a role on the event or a session bound to that booking; a bare id is not enough', () => {
  assert.equal(decide('booking:read', anon, { exists: true }).allow, false);
  assert.equal((decide('booking:read', anon, { exists: true }) as { status: number }).status, 401);
  assert.equal((decide('booking:read', user(), { exists: true, role: null }) as { status: number }).status, 404);
  assert.deepEqual(decide('booking:read', anon, { exists: true, bookingSession: true }), { allow: true, scope: 'booking-holder' });
  assert.deepEqual(decide('booking:read', user(), { exists: true, role: 'viewer' }), { allow: true, scope: 'owner' });
});

test('policy: public event reads only for active or published events', () => {
  for (const [status, allow] of [['active', true], ['published', true], ['draft', false], ['cancelled', false], ['completed', false], [undefined, false]] as const) {
    assert.equal(decide('event:read-public', anon, { exists: true, eventStatus: status }).allow, allow, String(status));
  }
});

test('public view is an allowlist: no id, guests, bookings, rules, agent or raw capacity', () => {
  const view = publicEventView({
    id: EV, name: 'Synthetic offsite', slug: 'synthetic', type: 'conference', venue: 'Hall', location: 'Pune', checkIn: '2027-01-10', checkOut: '2027-01-12', status: 'active',
    agentId: 'x', agent: { email: 'owner@example.test', password: 'hash' }, guests: [{ email: 'g@example.test' }], bookings: [{}], attritionRules: [{}], internalNote: 'secret',
    roomBlocks: [{ id: 'r1', roomType: 'Deluxe', rate: 100, totalQty: 10, bookedQty: 4 }], addOns: [{ id: 'a1', name: 'Dinner', price: 20, isIncluded: true }],
  });
  const text = JSON.stringify(view);
  for (const leaked of ['agent', 'guests', 'bookings', 'attrition', 'internalNote', 'secret', '@', 'password', EV, 'totalQty', 'bookedQty']) assert.ok(!text.includes(leaked), leaked);
  assert.equal((view.roomBlocks as { available: number }[])[0].available, 6);
});

test('booking-holder view shows the guest name only and lists the allowed actions', () => {
  const v = bookingHolderView({ id: 'b1', eventId: EV, totalAmount: 100, status: 'confirmed', guest: { name: 'Guest One', email: 'one@example.test', phone: '+91 1' } }, { name: 'E', slug: 's', type: 't', venue: 'v', location: 'l', checkIn: '2027-01-01', checkOut: '2027-01-02' });
  assert.deepEqual(v.guest, { name: 'Guest One' });
  assert.deepEqual(v.allowedActions, ['view']);
  assert.ok(!JSON.stringify(v).includes('@') && !JSON.stringify(v).includes('+91'));
});

test('event patch: allowlist rejects identity, linkage and status fields; validates values', () => {
  for (const field of ['id', 'slug', 'agentId', 'status', 'members', 'createdAt']) assert.equal(validateEventPatch({ [field]: 'x' }).ok, false, field);
  assert.equal(validateEventPatch({}).ok, false);
  assert.equal(validateEventPatch({ primaryColor: 'red' }).ok, false);
  assert.equal(validateEventPatch({ heroImageUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateEventPatch({ heroImageUrl: 'http://example.test/a.png' }).ok, false);
  assert.equal(validateEventPatch({ checkIn: '2027-02-10', checkOut: '2027-02-01' }).ok, false);
  assert.equal(validateEventPatch({ checkIn: '2027-02-10T10:00:00' }).ok, false, 'timestamps need a time zone');
  assert.equal(validateEventPatch({ name: 'a\u0000b' }).ok, false);
  assert.equal(validateEventPatch({ name: 'x'.repeat(201) }).ok, false);
  const good = validateEventPatch({ name: '  Offsite  ', primaryColor: '#1E40AF', heroImageUrl: 'https://example.test/a.png', expectedPax: 120 });
  assert.ok(good.ok && good.value.name === 'Offsite' && good.value.primaryColor === '#1e40af');
});

test('status: same transition table as the legacy route', () => {
  const legacy = readFileSync('src/app/api/events/[eventId]/status/route.ts', 'utf8');
  for (const [from, tos] of Object.entries(EVENT_STATUS_TRANSITIONS)) assert.ok(legacy.includes(`${from}: [${tos.map(t => `"${t}"`).join(', ')}]`), from);
  assert.equal(canTransition('draft', 'completed'), false);
  assert.equal(validateStatusChange({ status: 'archived' }).ok, false);
  assert.equal(validateStatusChange({ status: 'active', extra: 1 }).ok, false);
});

test('guest create/patch: eventId required on create, read-only fields refused, contact fields validated', () => {
  assert.equal(validateGuestCreate({ name: 'A' }).ok, false);
  assert.equal(validateGuestCreate({ eventId: EV, name: 'A', id: 'x' }).ok, false);
  assert.equal(validateGuestCreate({ eventId: EV, name: 'A', email: 'not-an-email' }).ok, false);
  assert.equal(validateGuestCreate({ eventId: EV, name: 'A', phone: '<script>' }).ok, false);
  assert.equal(validateGuestPatch({ eventId: 'nope', name: 'A' }).ok, false);
  const g = validateGuestCreate({ eventId: EV, name: 'Guest', email: 'Guest@Example.TEST', status: 'confirmed' });
  assert.ok(g.ok && g.value.guest.email === 'guest@example.test');
});

test('same-origin check: cross-site and header-less writes refused; same origin and listed origins accepted', () => {
  const req = (h: Record<string, string>) => new Request('https://tbo-assemble.example.test/api/v2/guests', { method: 'POST', headers: h });
  assert.equal(sameOriginCheck(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' })).ok, false);
  assert.equal(sameOriginCheck(req({ origin: 'https://evil.test' })).ok, false);
  assert.equal(sameOriginCheck(req({})).ok, false);
  assert.equal(sameOriginCheck(req({ 'sec-fetch-site': 'same-site', origin: 'https://sub.tbo-assemble.example.test' })).ok, false);
  assert.equal(sameOriginCheck(req({ origin: 'https://tbo-assemble.example.test' })).ok, true);
  assert.equal(sameOriginCheck(req({ 'sec-fetch-site': 'same-origin' })).ok, true);
  assert.equal(sameOriginCheck(req({ origin: 'https://preview.example.test' }), 'https://preview.example.test').ok, true);
});

test('JSON bodies: content type required, size capped while streaming (even without Content-Length)', async () => {
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 100; i++) c.enqueue(new TextEncoder().encode('"' + 'x'.repeat(1000) + '",')); c.close(); } });
  const r = await readJsonBody(new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big, duplex: 'half' } as RequestInit), 10_000);
  assert.deepEqual(r, { ok: false, error: 'The request body is too large.' });
  assert.equal((await readJsonBody(new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }))).ok, false);
  assert.equal((await readJsonBody(new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' }))).ok, false);
  assert.deepEqual(await readJsonBody(new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })), { ok: true, value: { a: 1 } });
});

test('capability tokens: 256-bit, url-safe, hashed; cookie is HttpOnly, SameSite=Lax, scoped to /api/v2', () => {
  const t = newToken();
  assert.match(t, TOKEN_FORMAT);
  assert.notEqual(newToken(), t);
  assert.match(hashToken(t), TOKEN_FORMAT);
  assert.notEqual(hashToken(t), t);
  const c = sessionCookie(t, new Date('2027-01-01T00:00:00Z'), true);
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/api/v2', 'Secure']) assert.ok(c.includes(part), part);
  assert.equal(readSessionCookie(new Request('https://x.test', { headers: { cookie: `a=1; tbo_booking_session=${t}` } })), t);
  assert.equal(readSessionCookie(new Request('https://x.test', { headers: { cookie: 'tbo_booking_session=short' } })), null);
});

test('audit lines carry pseudonyms, never raw user ids, booking ids or tokens', () => {
  const lines: string[] = [];
  audit({ action: 'booking.read', result: 'denied', status: 401, actor: ALICE, resource: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, l => lines.push(l));
  assert.ok(!lines[0].includes(ALICE) && !lines[0].includes('bbbbbbbb'));
  assert.ok(lines[0].includes(pseudonym(ALICE)));
});

/** Handler-level checks with a mock repository (no database). */
const mockDeps = (over: Partial<OwnerScopeDeps> = {}): OwnerScopeDeps => ({
  enabled: () => true,
  principal: async req => { const id = req.headers.get('x-test-user'); return id ? user(id) : anon; },
  repo: {
    listEvents: async () => [{ id: EV, role: 'owner' }],
    getEvent: async (_u: string, id: string) => (id === EV ? { event: { id: EV }, role: 'owner' } : null),
    updateEvent: async () => { throw new Error('must not be reached'); },
    roleOnBooking: async () => null,
  } as unknown as OwnerRepo,
  capabilities: { resolveSession: async () => null } as unknown as CapabilityStore,
  now: () => new Date('2026-11-17T00:00:00Z'),
  limit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  legacyBookingLinks: () => true,
  auditSink: () => {},
  ...over,
});

test('handlers: switch off -> 503; malformed or failing identity -> 401 (fail closed)', async () => {
  const off = await listEventsHandler(mockDeps({ enabled: () => false }))(new Request('https://x.test/api/v2/events'));
  assert.equal(off.status, 503);
  const throwing = await listEventsHandler(mockDeps({ principal: async () => { throw new Error('auth down'); } }))(new Request('https://x.test/api/v2/events'));
  assert.equal(throwing.status, 401);
  const malformed = await getEventHandler(mockDeps({ principal: async () => ({ kind: 'user', authUserId: 'not-a-uuid' }) }))(new Request('https://x.test'), EV);
  assert.equal(malformed.status, 401);
  assert.equal(off.headers.get('cache-control'), 'no-store, max-age=0');
});

test('handlers: cross-site write is refused before identity or data access', async () => {
  const r = await patchEventHandler(mockDeps())(new Request(`https://x.test/api/v2/events/${EV}`, { method: 'PATCH', headers: { 'x-test-user': ALICE, origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{"name":"x"}' }), EV);
  assert.equal(r.status, 403);
});

test('handlers: anonymous booking read gets the same 401 for existing and random ids', async () => {
  const h = getBookingHandler(mockDeps());
  const a = await h(new Request('https://x.test'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const b = await h(new Request('https://x.test'), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(a.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});
