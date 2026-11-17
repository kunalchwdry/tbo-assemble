/**
 * Owner-scoped (v2) API against a REAL, ISOLATED PostgreSQL database: authorization matrix, booking capabilities,
 * the legacy-link bridge, public view, revocation and a concurrency check. Synthetic data only.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/tbo_sec_test npx tsx --test tests/owner-scope-db.test.ts
 *
 * The database must already have the schema (main schema + docs/security/migrations/*.up.sql). The test WIPES the
 * tables it uses, so it refuses any URL that is not on localhost. Without TEST_DATABASE_URL it is skipped.
 * Identity is injected (x-test-user header) because no Supabase project is available here; everything below the
 * identity check (queries, transactions, locks, tokens) is real.
 */
import { describe, test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ownerRepo } from '../src/lib/access/owner-repo';
import { capabilityStore, hashToken } from '../src/lib/access/booking-capability';
import * as H from '../src/lib/access/owner-scope-handlers';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_ && !/^postgresql:\/\/[^@/]+@(127\.0\.0\.1|localhost):\d+\/[\w-]+$/.test(URL_)) throw new Error('Refusing: TEST_DATABASE_URL must be a local isolated database.');
const skip = URL_ ? false : 'TEST_DATABASE_URL not set: isolated-database tests skipped';

const ALICE = '11111111-1111-4111-8111-111111111111', BOB = '22222222-2222-4222-8222-222222222222', CAROL = '33333333-3333-4333-8333-333333333333', DAVE = '44444444-4444-4444-8444-444444444444', EVE = '55555555-5555-4555-8555-555555555555';
const EV_A = 'a0000000-0000-4000-8000-00000000000a', EV_B = 'b0000000-0000-4000-8000-00000000000b', EV_U = 'c0000000-0000-4000-8000-00000000000c';
const RB_A = 'a1000000-0000-4000-8000-0000000000a1', RB_B = 'b1000000-0000-4000-8000-0000000000b1', RB_U = 'c1000000-0000-4000-8000-0000000000c1';
const G_A1 = 'a2000000-0000-4000-8000-0000000000a1', G_A2 = 'a2000000-0000-4000-8000-0000000000a2', G_B1 = 'b2000000-0000-4000-8000-0000000000b1', G_U1 = 'c2000000-0000-4000-8000-0000000000c1';
const BK_A1 = 'a3000000-0000-4000-8000-0000000000a1', BK_B1 = 'b3000000-0000-4000-8000-0000000000b1', BK_U1 = 'c3000000-0000-4000-8000-0000000000c1';
const RANDOM = 'd0000000-0000-4000-8000-0000000000d0';
const ORIGIN = 'https://app.example.test';
const INVALID_LINK = { error: 'This link is not valid or has expired. Ask the organiser for a new one.' };

let prisma: PrismaClient;
let deps: H.OwnerScopeDeps;
let clock = new Date();
let legacyOn = true;
const auditLines: string[] = [];
const tokensSeen: string[] = [];

type Opts = { user?: string; body?: unknown; cookie?: string; origin?: string | null; raw?: string };
function req(method: string, path: string, o: Opts = {}) {
  const h: Record<string, string> = {};
  if (o.user) h['x-test-user'] = o.user;
  if (o.cookie) h.cookie = o.cookie;
  if (method !== 'GET' && o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.body !== undefined || o.raw !== undefined) h['content-type'] = 'application/json';
  return new Request(ORIGIN + path, { method, headers: h, body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)) });
}
const call = async (p: Promise<Response>) => { const r = await p; return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const eventName = async (id: string) => (await prisma.event.findUniqueOrThrow({ where: { id } })).name;

async function seed() {
  await prisma.$executeRawUnsafe('TRUNCATE "BookingAccess","EventMember","BookingAddOn","Booking","Guest","RoomBlock","AddOn","AttritionRule","Event","Agent" CASCADE');
  await prisma.agent.create({ data: { id: 'agent-1', name: 'Synthetic agent', email: 'agent@example.test', password: 'not-a-real-password' } });
  const ev = (id: string, slug: string, status: string) => prisma.event.create({ data: { id, slug, status, name: `Event ${slug}`, type: 'conference', venue: 'Synthetic hall', location: 'Pune', checkIn: new Date('2027-01-10'), checkOut: new Date('2027-01-12'), agentId: 'agent-1' } });
  await ev(EV_A, 'ev-a', 'draft'); await ev(EV_B, 'ev-b', 'active'); await ev(EV_U, 'ev-unclaimed', 'active');
  for (const [id, eventId] of [[RB_A, EV_A], [RB_B, EV_B], [RB_U, EV_U]]) await prisma.roomBlock.create({ data: { id, eventId, roomType: 'Deluxe', rate: 100, totalQty: 10, bookedQty: 1 } });
  for (const [id, eventId, n] of [[G_A1, EV_A, 'One'], [G_A2, EV_A, 'Two'], [G_B1, EV_B, 'Three'], [G_U1, EV_U, 'Four']]) await prisma.guest.create({ data: { id, eventId, name: `Guest ${n}`, email: `guest.${n.toLowerCase()}@example.test`, phone: '+91 00000 00000' } });
  for (const [id, guestId, eventId, roomBlockId] of [[BK_A1, G_A1, EV_A, RB_A], [BK_B1, G_B1, EV_B, RB_B], [BK_U1, G_U1, EV_U, RB_U]]) await prisma.booking.create({ data: { id, guestId, eventId, roomBlockId, totalAmount: 100 } });
  await prisma.eventMember.createMany({ data: [
    { eventId: EV_A, authUserId: ALICE, role: 'owner', grantedBy: 'test-fixture' },
    { eventId: EV_A, authUserId: CAROL, role: 'viewer' },
    { eventId: EV_A, authUserId: DAVE, role: 'editor' },
    { eventId: EV_B, authUserId: BOB, role: 'owner' },
  ] });
}

describe('owner-scoped API on an isolated database', { skip }, () => {
  before(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_! }) });
    await seed();
    deps = {
      enabled: () => true,
      principal: async r => { const id = r.headers.get('x-test-user'); return id ? { kind: 'user', authUserId: id } : { kind: 'anonymous' }; },
      repo: ownerRepo(prisma), capabilities: capabilityStore(prisma), now: () => clock,
      limit: () => ({ allowed: true, retryAfterSeconds: 0 }), legacyBookingLinks: () => legacyOn, auditSink: l => auditLines.push(l),
    };
  });
  after(async () => { await prisma?.$disconnect(); });

  test('list: each user sees only events they hold a role on; unclaimed events never appear', async () => {
    assert.equal((await call(H.listEventsHandler(deps)(req('GET', '/api/v2/events')))).status, 401);
    const ids = async (u: string) => (await call(H.listEventsHandler(deps)(req('GET', '/api/v2/events', { user: u })))).body.events.map((e: { id: string; role: string }) => `${e.id}:${e.role}`);
    assert.deepEqual(await ids(ALICE), [`${EV_A}:owner`]);
    assert.deepEqual(await ids(CAROL), [`${EV_A}:viewer`]);
    assert.deepEqual(await ids(BOB), [`${EV_B}:owner`]);
    assert.deepEqual(await ids(EVE), []);
  });

  test('detail: member 200; other user, unclaimed and missing all give the identical 404; anonymous 401', async () => {
    const own = await call(H.getEventHandler(deps)(req('GET', '/x', { user: ALICE }), EV_A));
    assert.equal(own.status, 200);
    assert.equal(own.body.event.guests.length, 2);
    assert.ok(!('agentId' in own.body.event) && !JSON.stringify(own.body).includes('not-a-real-password'));
    const other = await call(H.getEventHandler(deps)(req('GET', '/x', { user: BOB }), EV_A));
    const unclaimed = await call(H.getEventHandler(deps)(req('GET', '/x', { user: ALICE }), EV_U));
    const missing = await call(H.getEventHandler(deps)(req('GET', '/x', { user: ALICE }), RANDOM));
    for (const r of [other, unclaimed, missing]) assert.deepEqual([r.status, r.body], [404, { error: 'Not found.' }]);
    assert.equal((await call(H.getEventHandler(deps)(req('GET', '/x'), EV_A))).status, 401);
  });

  test('event writes: owner/editor change it; viewer 403, other user 404, anonymous 401, cross-site 403 — and those leave the row unchanged', async () => {
    const patch = (user: string | undefined, body: unknown, id = EV_A, origin?: string | null) => call(H.patchEventHandler(deps)(req('PATCH', '/x', { user, body, origin }), id));
    const before_ = await eventName(EV_A);
    assert.equal((await patch(BOB, { name: 'Hijacked' })).status, 404);
    assert.equal((await patch(CAROL, { name: 'Viewer edit' })).status, 403);
    assert.equal((await patch(undefined, { name: 'Anon edit' })).status, 401);
    assert.equal((await patch(ALICE, { name: 'Cross-site edit' }, EV_A, 'https://evil.test')).status, 403);
    assert.equal((await patch(ALICE, { name: 'No origin' }, EV_A, null)).status, 403);
    assert.equal((await patch(ALICE, { slug: 'stolen-link' })).status, 400);
    assert.equal((await patch(ALICE, { name: 'Unclaimed edit' }, EV_U)).status, 404);
    assert.equal(await eventName(EV_A), before_);
    assert.equal(await eventName(EV_U), 'Event ev-unclaimed');
    assert.equal((await patch(ALICE, { name: 'Renamed by owner' })).status, 200);
    assert.equal((await patch(DAVE, { venue: 'Editor venue' })).status, 200);
    assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: EV_A }, select: { name: true, venue: true } }), { name: 'Renamed by owner', venue: 'Editor venue' });
    assert.equal((await patch(ALICE, { checkOut: '2026-01-01' })).status, 400, 'checkOut before the stored checkIn');
    const big = await call(H.patchEventHandler(deps)(req('PATCH', '/x', { user: ALICE, raw: JSON.stringify({ description: 'x'.repeat(70_000) }) }), EV_A));
    assert.equal(big.status, 413);
  });

  test('status: transition table enforced; concurrent changes resolve as compare-and-set (exactly one wins)', async () => {
    const status = (user: string, to: string) => call(H.eventStatusHandler(deps)(req('POST', '/x', { user, body: { status: to } }), EV_A));
    assert.equal((await status(CAROL, 'active')).status, 403);
    assert.equal((await status(BOB, 'active')).status, 404);
    assert.equal((await status(ALICE, 'completed')).status, 409);
    // Five identical transitions at once: whether they interleave (compare-and-set refuses the losers) or run one
    // after another (active -> active is not a transition), exactly one may succeed.
    const results = await Promise.all([ALICE, DAVE, ALICE, DAVE, ALICE].map(u => status(u, 'active')));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
    assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: EV_A } })).status, 'active');
  });

  test('guests: list/create/update/delete scoped to the event; cross-event child ids and other users rejected without writes', async () => {
    const list = (user: string | undefined, eventId: string) => call(H.listGuestsHandler(deps)(req('GET', `/api/v2/guests?eventId=${eventId}`, { user })));
    assert.equal((await list(ALICE, EV_A)).body.guests.length, 2);
    assert.equal((await list(CAROL, EV_A)).status, 200);
    assert.equal((await list(BOB, EV_A)).status, 404);
    assert.equal((await list(ALICE, EV_U)).status, 404);
    assert.equal((await list(undefined, EV_A)).status, 401);
    const create = (user: string, body: unknown) => call(H.createGuestHandler(deps)(req('POST', '/x', { user, body })));
    assert.equal((await create(BOB, { eventId: EV_A, name: 'Injected' })).status, 404);
    assert.equal((await create(CAROL, { eventId: EV_A, name: 'Viewer guest' })).status, 403);
    assert.equal((await create(ALICE, { eventId: EV_U, name: 'Unclaimed guest' })).status, 404);
    assert.equal((await create(ALICE, { eventId: EV_A, name: 'X', id: RANDOM })).status, 400);
    assert.equal(await prisma.guest.count({ where: { name: { in: ['Injected', 'Viewer guest', 'Unclaimed guest', 'X'] } } }), 0);
    const made = await create(ALICE, { eventId: EV_A, name: 'Added by owner', email: 'added@example.test' });
    assert.equal(made.status, 201);
    assert.equal((await prisma.guest.findUniqueOrThrow({ where: { id: made.body.id } })).eventId, EV_A);
    const patch = (user: string, id: string, body: unknown) => call(H.patchGuestHandler(deps)(req('PATCH', '/x', { user, body }), id));
    assert.equal((await patch(BOB, G_A2, { notes: 'bob' })).status, 404);
    assert.equal((await patch(ALICE, G_A2, { eventId: EV_B, notes: 'mismatch' })).status, 404, 'guest of A addressed through event B');
    assert.equal((await patch(ALICE, G_B1, { notes: 'other owner' })).status, 404);
    assert.equal((await patch(CAROL, G_A2, { notes: 'viewer' })).status, 403);
    assert.equal((await prisma.guest.findUniqueOrThrow({ where: { id: G_A2 } })).notes, null);
    assert.equal((await prisma.guest.findUniqueOrThrow({ where: { id: G_B1 } })).notes, null);
    assert.equal((await patch(ALICE, G_A2, { notes: 'owner note' })).status, 200);
    const del = (user: string, id: string) => call(H.deleteGuestHandler(deps)(req('DELETE', '/x', { user }), id));
    assert.equal((await del(ALICE, G_A1)).status, 409, 'active booking keeps the guest');
    assert.equal((await del(BOB, G_A2)).status, 404);
    assert.equal(await prisma.guest.count({ where: { id: { in: [G_A1, G_A2] } } }), 2);
    assert.equal((await del(ALICE, G_A2)).status, 200);
    assert.equal(await prisma.guest.count({ where: { id: G_A2 } }), 0);
  });

  test('bookings: anonymous 401 (same for real and random ids), non-member 404, members see the full booking', async () => {
    const get = (id: string, o: Opts = {}) => call(H.getBookingHandler(deps)(req('GET', '/x', o), id));
    const a = await get(BK_A1), r = await get(RANDOM);
    assert.deepEqual([a.status, a.body], [r.status, r.body]);
    assert.equal(a.status, 401);
    assert.equal((await get(BK_A1, { user: BOB })).status, 404);
    const owner = await get(BK_A1, { user: ALICE });
    assert.equal(owner.body.scope, 'owner');
    assert.equal(owner.body.booking.guest.email, 'guest.one@example.test');
    assert.equal((await get(BK_A1, { user: CAROL })).body.scope, 'owner');
    assert.equal((await get(BK_U1, { user: ALICE })).status, 404, 'unclaimed booking not exposed to the owner API');
  });

  test('capabilities: owner issues a link (hash stored only); exchange gives an HttpOnly session bound to one booking; altered, expired and revoked fail', async () => {
    const issue = (user: string | undefined, body: unknown = {}) => call(H.issueBookingAccessHandler(deps)(req('POST', '/x', { user, body }), BK_A1));
    assert.equal((await issue(DAVE)).status, 403, 'editors cannot issue links');
    assert.equal((await issue(BOB)).status, 404);
    assert.equal((await issue(undefined)).status, 401);
    const issued = await issue(ALICE, { scope: 'view', expiresInDays: 30 });
    assert.equal(issued.status, 201);
    const token = String(issued.body.url).split('#')[1];
    tokensSeen.push(token);
    assert.ok(String(issued.body.url).startsWith(`${ORIGIN}/booking/access#`) && token.length === 43);
    const rows = await prisma.bookingAccess.findMany({ where: { bookingId: BK_A1 } });
    assert.ok(rows.some(x => x.tokenHash === hashToken(token)) && !rows.some(x => x.tokenHash === token));

    const exchange = (t: string, origin?: string) => call(H.exchangeLinkHandler(deps)(req('POST', '/x', { body: { token: t }, origin })));
    const ex = await exchange(token);
    assert.equal(ex.status, 200);
    const setCookie = ex.headers.get('set-cookie') ?? '';
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/api/v2', 'Secure']) assert.ok(setCookie.includes(part), part);
    const cookie = setCookie.split(';')[0];
    tokensSeen.push(cookie.split('=')[1]);
    const holder = await call(H.getBookingHandler(deps)(req('GET', '/x', { cookie }), BK_A1));
    assert.equal(holder.body.scope, 'booking-holder');
    assert.deepEqual(holder.body.booking.guest, { name: 'Guest One' });
    assert.ok(!JSON.stringify(holder.body).includes('@'));
    assert.equal((await call(H.getBookingHandler(deps)(req('GET', '/x', { cookie }), BK_B1))).status, 401, 'session is bound to its booking');

    const altered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const bad of [altered, 'garbage', '']) assert.deepEqual([(await exchange(bad)).status, (await exchange(bad)).body], [404, INVALID_LINK]);
    assert.equal((await exchange(token, 'https://evil.test')).status, 403);

    const realNow = clock;
    clock = new Date(realNow.getTime() + 13 * 3600_000);
    assert.equal((await call(H.getBookingHandler(deps)(req('GET', '/x', { cookie }), BK_A1))).status, 401, 'session expired after 12 h');
    clock = realNow;

    const revoked = await call(H.revokeBookingAccessHandler(deps)(req('DELETE', '/x', { user: ALICE }), BK_A1));
    assert.ok(revoked.body.revoked >= 2);
    assert.equal((await call(H.getBookingHandler(deps)(req('GET', '/x', { cookie }), BK_A1))).status, 401, 'revocation ends live sessions');
    assert.deepEqual((await exchange(token)).body, INVALID_LINK);

    const short = await issue(ALICE, { expiresInDays: 1 });
    clock = new Date(realNow.getTime() + 2 * 86_400_000);
    assert.equal((await exchange(String(short.body.url).split('#')[1])).status, 404, 'expired link');
    clock = realNow;
  });

  test('legacy booking URL bridge: view-only 2 h session, uniform failures, switchable off', async () => {
    const legacy = (bookingId: string, origin?: string) => call(H.legacyBookingLinkHandler(deps)(req('POST', '/x', { body: { bookingId }, origin })));
    const ok = await legacy(BK_B1);
    assert.equal(ok.status, 200);
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0];
    const view = await call(H.getBookingHandler(deps)(req('GET', '/x', { cookie }), BK_B1));
    assert.deepEqual(view.body.booking.allowedActions, ['view']);
    assert.deepEqual([(await legacy(RANDOM)).status, (await legacy(RANDOM)).body], [404, INVALID_LINK]);
    assert.deepEqual((await legacy('not-a-uuid')).body, INVALID_LINK);
    assert.equal((await legacy(BK_B1, 'https://evil.test')).status, 403);
    const realNow = clock;
    clock = new Date(realNow.getTime() + 3 * 3600_000);
    assert.equal((await call(H.getBookingHandler(deps)(req('GET', '/x', { cookie }), BK_B1))).status, 401);
    clock = realNow;
    legacyOn = false;
    assert.equal((await legacy(BK_B1)).status, 410);
    legacyOn = true;
    assert.ok(auditLines.some(l => l.includes('"booking.access.legacy"')) && !auditLines.some(l => l.includes(BK_B1)));
  });

  test('public event view: active/published only, public fields only', async () => {
    const pub = (slug: string) => call(H.publicEventHandler(deps)(req('GET', '/x'), slug));
    const b = await pub('ev-b');
    assert.equal(b.status, 200);
    const text = JSON.stringify(b.body);
    for (const leaked of ['@', 'guests', 'bookings', 'agent', EV_B, 'not-a-real-password', 'bookedQty']) assert.ok(!text.includes(leaked), leaked);
    assert.equal((await pub('ev-unclaimed')).status, 200, 'public links of unclaimed events keep working');
    await prisma.event.update({ where: { id: EV_B }, data: { status: 'draft' } });
    assert.equal((await pub('ev-b')).status, 404);
    await prisma.event.update({ where: { id: EV_B }, data: { status: 'active' } });
    assert.equal((await pub('no-such-event')).status, 404);
  });

  test('revoked membership takes effect immediately; the repository enforces scope without the handler', async () => {
    await prisma.eventMember.updateMany({ where: { eventId: EV_A, authUserId: ALICE }, data: { revokedAt: new Date() } });
    assert.equal((await call(H.getEventHandler(deps)(req('GET', '/x', { user: ALICE }), EV_A))).status, 404);
    assert.equal((await call(H.patchEventHandler(deps)(req('PATCH', '/x', { user: ALICE, body: { name: 'after revoke' } }), EV_A))).status, 404);
    await prisma.eventMember.updateMany({ where: { eventId: EV_A, authUserId: ALICE }, data: { revokedAt: null } });
    const repo = ownerRepo(prisma);
    assert.deepEqual(await repo.updateEvent(BOB, EV_A, { name: 'repo bypass' }), { kind: 'not-found' });
    assert.equal(await repo.listGuests(BOB, EV_A), null);
    assert.equal(await repo.getBookingForMember(BOB, BK_A1), null);
    assert.deepEqual(await repo.deleteGuest(EVE, G_A1, undefined), { kind: 'not-found' });
    assert.notEqual(await eventName(EV_A), 'repo bypass');
  });

  test('concurrency: an insert racing a membership revocation waits for it and is then refused (row lock)', async () => {
    let release!: () => void; const gate = new Promise<void>(r => (release = r));
    let locked!: () => void; const isLocked = new Promise<void>(r => (locked = r));
    const revoker = prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "EventMember" SET "revokedAt" = now() WHERE "eventId" = ${EV_A} AND "authUserId" = ${DAVE}::uuid`;
      locked();
      await gate;
    }, { timeout: 20_000 });
    await isLocked;
    let settled = false;
    const insert = deps.repo.createGuest(DAVE, EV_A, { name: 'Race guest' });
    insert.then(() => (settled = true), () => (settled = true));
    await new Promise(r => setTimeout(r, 500));
    assert.equal(settled, false, 'insert must wait for the revocation');
    release();
    await revoker;
    assert.deepEqual(await insert, { kind: 'not-found' });
    assert.equal(await prisma.guest.count({ where: { name: 'Race guest' } }), 0);
    await prisma.eventMember.updateMany({ where: { eventId: EV_A, authUserId: DAVE }, data: { revokedAt: null } });
  });

  test('audit log: pseudonymous actors and resources; no raw user ids, booking ids, tokens or emails', () => {
    assert.ok(auditLines.length > 50);
    const all = auditLines.join('\n');
    for (const secret of [ALICE, BOB, CAROL, DAVE, BK_A1, BK_B1, '@example.test', ...tokensSeen]) assert.ok(!all.includes(secret), `audit leaked ${secret.slice(0, 8)}`);
    assert.ok(auditLines.every(l => JSON.parse(l).type === 'security'));
  });
});
