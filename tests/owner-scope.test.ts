/**
 * Owner-scoped replacement for the legacy event/guest/booking API: authorization and denial with local mocks only.
 * No database, no Supabase, no network. Synthetic ids and names.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decide, publicEventView, bookingHolderView, type EventLike, type Principal } from '../src/lib/access/event-access';
import { listEventsHandler, getEventHandler, listGuestsHandler, getBookingHandler, type OwnerScopeDeps } from '../src/lib/access/owner-scope-handlers';

const ALICE = '11111111-1111-4111-8111-111111111111', BOB = '22222222-2222-4222-8222-222222222222';
const EV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', EV_UNCLAIMED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', EV_MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BK_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', BK_UNCLAIMED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const alice: Principal = { kind: 'user', authUserId: ALICE }, bob: Principal = { kind: 'user', authUserId: BOB }, anon: Principal = { kind: 'anonymous' };

const event = (id: string, slug: string): EventLike => ({
  id, name: `Synthetic offsite ${slug}`, slug, type: 'conference', venue: 'Test venue', location: 'Goa', checkIn: '2027-01-10', checkOut: '2027-01-12', status: 'published',
  roomBlocks: [{ id: 'rb-1', roomType: 'Deluxe', rate: 9000, totalQty: 10, bookedQty: 4 }], addOns: [{ id: 'ad-1', name: 'Airport transfer', price: 1200 }],
  guests: [{ id: 'g-1', name: 'Guest One', email: 'one@example.test', phone: '+910000000001' }, { id: 'g-2', name: 'Guest Two', email: 'two@example.test' }],
  bookings: [{ id: 'other-booking', guestId: 'g-2', totalAmount: 18000 }], attritionRules: [{ id: 'ar-1', cutoff: '2026-12-01' }], agentId: 'agent-1', activityLogs: [{ id: 'log' }],
});
const EVENTS: Record<string, { event: EventLike; ownerAuthUserId: string | null }> = {
  [EV_A]: { event: event(EV_A, 'alice-offsite'), ownerAuthUserId: ALICE },
  [EV_UNCLAIMED]: { event: event(EV_UNCLAIMED, 'legacy-demo'), ownerAuthUserId: null },
};
const BOOKINGS: Record<string, { booking: { id: string; eventId: string; totalAmount: number; status: string; guestId: string; roomBlockId: string; guest: { name: string; email: string; phone: string } }; eventId: string }> = {
  [BK_A]: { booking: { id: BK_A, eventId: EV_A, totalAmount: 18000, status: 'confirmed', guestId: 'g-1', roomBlockId: 'rb-1', guest: { name: 'Guest One', email: 'one@example.test', phone: '+910000000001' } }, eventId: EV_A },
  [BK_UNCLAIMED]: { booking: { id: BK_UNCLAIMED, eventId: EV_UNCLAIMED, totalAmount: 9000, status: 'confirmed', guestId: 'g-1', roomBlockId: 'rb-1', guest: { name: 'Guest One', email: 'one@example.test', phone: '+910000000001' } }, eventId: EV_UNCLAIMED },
};

function mockDeps(who: Principal | Error, enabled = true) {
  const calls: string[] = [];
  const deps: OwnerScopeDeps = {
    enabled: () => enabled,
    principal: async () => { calls.push('principal'); if (who instanceof Error) throw who; return who; },
    listOwnedEvents: async id => { calls.push(`listOwnedEvents:${id}`); return Object.values(EVENTS).filter(e => e.ownerAuthUserId === id).map(e => ({ id: e.event.id, name: e.event.name, slug: e.event.slug } as EventLike)); },
    getEvent: async id => { calls.push(`getEvent:${id}`); return EVENTS[id] ?? null; },
    listGuests: async id => { calls.push(`listGuests:${id}`); return (EVENTS[id]?.event.guests as Record<string, unknown>[]) ?? []; },
    getBooking: async id => { calls.push(`getBooking:${id}`); const b = BOOKINGS[id]; return b ? { booking: b.booking, event: EVENTS[b.eventId] } : null; },
  };
  return { deps, calls };
}
const req = (path: string) => new Request(`http://localhost${path}`);
const body = async (r: Response) => ({ status: r.status, json: await r.json(), cache: r.headers.get('cache-control') });
const PRIVATE_KEYS = ['guests', 'bookings', 'attritionRules', 'agentId', 'activityLogs'];

test('policy: owner-only actions need a session (401) and ownership (404 otherwise); unclaimed events have no owner', () => {
  for (const action of ['event:read', 'event:write', 'guest:list', 'guest:write', 'booking:write'] as const) {
    assert.deepEqual(decide(action, anon, { exists: true, ownerAuthUserId: ALICE }), { allow: false, status: 401, reason: 'Sign in to manage events.' });
    assert.equal(decide(action, anon, { exists: false }).allow, false, 'anonymous gets 401 whether or not it exists');
    assert.equal((decide(action, anon, { exists: false }) as { status: number }).status, 401);
    assert.deepEqual(decide(action, alice, { exists: true, ownerAuthUserId: ALICE }), { allow: true, scope: 'owner' });
    const cross = decide(action, bob, { exists: true, ownerAuthUserId: ALICE }), missing = decide(action, bob, { exists: false });
    assert.deepEqual(cross, missing, 'another user\'s resource is indistinguishable from a missing one');
    assert.equal((cross as { status: number }).status, 404);
    const signedIn: Principal[] = [alice, bob];
    for (const who of signedIn) assert.equal((decide(action, who, { exists: true, ownerAuthUserId: null }) as { status: number }).status, 404, 'unclaimed: nobody owns it');
    assert.equal(decide(action, { kind: 'user', authUserId: '' }, { exists: true, ownerAuthUserId: '' }).allow, false, 'empty ids never match');
  }
  assert.deepEqual(decide('event:list', alice), { allow: true, scope: 'owner' });
  assert.equal((decide('event:list', anon) as { status: number }).status, 401);
});

test('policy: share links and booking links grant only their narrow view', () => {
  assert.deepEqual(decide('event:read-public', anon, { exists: true, ownerAuthUserId: null, slugMatches: true }), { allow: true, scope: 'public' });
  assert.equal((decide('event:read-public', anon, { exists: true, slugMatches: false }) as { status: number }).status, 404);
  assert.deepEqual(decide('booking:read', anon, { exists: true, ownerAuthUserId: ALICE, bookingMatches: true }), { allow: true, scope: 'booking-holder' });
  assert.deepEqual(decide('booking:read', bob, { exists: true, ownerAuthUserId: ALICE, bookingMatches: true }), { allow: true, scope: 'booking-holder' }, 'another signed-in user with the link is still only a holder');
  assert.deepEqual(decide('booking:read', alice, { exists: true, ownerAuthUserId: ALICE, bookingMatches: false }), { allow: true, scope: 'owner' });
  assert.equal((decide('booking:read', anon, { exists: true, bookingMatches: false }) as { status: number }).status, 404);
  assert.equal((decide('booking:create', anon, { exists: true, slugMatches: true, eventStatus: 'cancelled' }) as { status: number }).status, 403);
  assert.equal(decide('booking:create', anon, { exists: true, slugMatches: true, eventStatus: 'published' }).allow, true);
  const view = publicEventView(EVENTS[EV_A].event);
  for (const k of PRIVATE_KEYS) assert.ok(!(k in view), `public view leaks ${k}`);
  assert.deepEqual((view.roomBlocks as { available: number }[]).map(r => r.available), [6]);
  const holder = bookingHolderView(BOOKINGS[BK_A].booking, EVENTS[EV_A].event);
  assert.deepEqual(holder.guest, { name: 'Guest One' }, 'holder view drops email and phone');
  assert.ok(!JSON.stringify(holder).includes('two@example.test') && !JSON.stringify(holder).includes('other-booking'), 'no other guests or bookings');
});

test('handlers: disabled by default answer 503 without touching identity or data', async () => {
  const { deps, calls } = mockDeps(alice, false);
  for (const r of [await listEventsHandler(deps)(req('/api/v2/events')), await getEventHandler(deps)(req('/x'), EV_A), await listGuestsHandler(deps)(req(`/api/v2/guests?eventId=${EV_A}`)), await getBookingHandler(deps)(req('/x'), BK_A)]) {
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('cache-control'), 'no-store, max-age=0');
  }
  assert.deepEqual(calls, []);
});

test('handlers: anonymous and failed sessions are denied (401); malformed identities count as anonymous', async () => {
  for (const who of [anon, new Error('auth service down'), { kind: 'user', authUserId: 'not-a-uuid' } as Principal]) {
    const { deps, calls } = mockDeps(who);
    assert.equal((await listEventsHandler(deps)(req('/api/v2/events'))).status, 401);
    assert.equal((await getEventHandler(deps)(req('/x'), EV_A)).status, 401);
    assert.equal((await listGuestsHandler(deps)(req(`/api/v2/guests?eventId=${EV_A}`))).status, 401);
    assert.ok(calls.every(c => c === 'principal'), `no data read for ${JSON.stringify(who)}: ${calls}`);
  }
});

test('handlers: owners see their own data; other users get the same 404 as for a missing event, and no data is read', async () => {
  const a = mockDeps(alice);
  const list = await body(await listEventsHandler(a.deps)(req('/api/v2/events')));
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.events.map((e: EventLike) => e.id), [EV_A], 'only the user\'s events; unclaimed legacy events are not listed');
  const detail = await body(await getEventHandler(a.deps)(req('/x'), EV_A));
  assert.equal(detail.status, 200);
  assert.equal(detail.json.event.guests.length, 2, 'owner view includes guests');
  assert.equal(detail.cache, 'no-store, max-age=0');
  assert.equal((await listGuestsHandler(a.deps)(req(`/api/v2/guests?eventId=${EV_A}`))).status, 200);

  const b = mockDeps(bob);
  const cross = await body(await getEventHandler(b.deps)(req('/x'), EV_A));
  const missing = await body(await getEventHandler(b.deps)(req('/x'), EV_MISSING));
  assert.equal(cross.status, 404);
  assert.deepEqual(cross, missing, 'no enumeration: same status and body');
  assert.equal((await getEventHandler(b.deps)(req('/x'), EV_UNCLAIMED)).status, 404, 'unclaimed legacy events are not exposed by the new API');
  const guests = await listGuestsHandler(b.deps)(req(`/api/v2/guests?eventId=${EV_A}`));
  assert.equal(guests.status, 404);
  assert.ok(!b.calls.some(c => c.startsWith('listGuests')), 'guests are never loaded for a non-owner');
  assert.equal((await listGuestsHandler(b.deps)(req('/api/v2/guests?eventId=../../etc'))).status, 400);
  assert.equal((await getEventHandler(b.deps)(req('/x'), "1' OR '1'='1")).status, 404);
  assert.ok(!b.calls.some(c => c.includes("'")), 'malformed ids never reach the data layer');
});

test('handlers: a booking link keeps working for its holder (narrow view), including for unclaimed legacy events', async () => {
  const holder = mockDeps(anon);
  const own = await body(await getBookingHandler(holder.deps)(req('/x'), BK_A));
  assert.equal(own.status, 200);
  assert.equal(own.json.scope, 'booking-holder');
  assert.equal(own.json.booking.id, BK_A);
  assert.deepEqual(own.json.booking.guest, { name: 'Guest One' });
  assert.equal(own.json.booking.event.roomBlocks[0].available, 6, 'room availability for the upgrade flow');
  for (const k of PRIVATE_KEYS) assert.ok(!(k in own.json.booking.event), `holder view leaks ${k}`);
  assert.ok(!JSON.stringify(own.json).includes('one@example.test'), 'no contact details in the holder view');
  const legacy = await body(await getBookingHandler(holder.deps)(req('/x'), BK_UNCLAIMED));
  assert.equal(legacy.status, 200, 'existing booking links for unclaimed events keep working');
  assert.equal((await getBookingHandler(holder.deps)(req('/x'), 'ffffffff-ffff-4fff-8fff-ffffffffffff')).status, 404);
  assert.equal((await getBookingHandler(holder.deps)(req('/x'), 'guessable-1')).status, 404);
  const owner = await body(await getBookingHandler(mockDeps(alice).deps)(req('/x'), BK_A));
  assert.equal(owner.json.scope, 'owner');
  assert.equal(owner.json.booking.guest.email, 'one@example.test', 'the event owner sees the full booking');
});

test('routes: the v2 endpoints answer 503 while OWNER_SCOPE_API is unset, without loading the database or Supabase', async () => {
  const before = process.env.OWNER_SCOPE_API;
  delete process.env.OWNER_SCOPE_API;
  const events = await import('../src/app/api/v2/events/route');
  const detail = await import('../src/app/api/v2/events/[eventId]/route');
  const guests = await import('../src/app/api/v2/guests/route');
  const booking = await import('../src/app/api/v2/bookings/[bookingId]/route');
  assert.equal((await events.GET(req('/api/v2/events'))).status, 503);
  assert.equal((await detail.GET(req('/x'), { params: Promise.resolve({ eventId: EV_A }) })).status, 503);
  assert.equal((await guests.GET(req(`/api/v2/guests?eventId=${EV_A}`))).status, 503);
  assert.equal((await booking.GET(req('/x'), { params: Promise.resolve({ bookingId: BK_A }) })).status, 503);
  if (before !== undefined) process.env.OWNER_SCOPE_API = before;
});
