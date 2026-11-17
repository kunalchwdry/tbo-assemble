/**
 * Owner-scoped API (v2) as handler factories. Dependencies (identity, data access, capabilities, limits, clock) are
 * injected, so the same handlers are tested with mocks (tests/owner-scope.test.ts) and against an isolated PostgreSQL
 * database (tests/owner-scope-db.test.ts). The routes under src/app/api/v2 wire in the real dependencies.
 *
 * Disabled by default: every handler answers 503 until OWNER_SCOPE_API=1 is set, which needs the approved schema
 * migration first. The legacy routes are not changed by this module.
 *
 * Order of checks in a write: feature switch -> same-origin (CSRF) -> verified identity (401) -> body size and schema
 * (400) -> data access with the ownership condition inside the query (404 / 403 / 409) -> audit line.
 */
import { decide, publicEventView, bookingHolderView, UUID, type Principal } from './event-access';
import { readJsonBody, validateEventPatch, validateStatusChange, validateGuestCreate, validateGuestPatch, validateAccessGrant } from './validate';
import { sameOriginCheck, requestOrigin, audit } from './request-guards';
import { readSessionCookie, sessionCookie, type CapabilityStore } from './booking-capability';
import type { OwnerRepo, WriteOutcome } from './owner-repo';

export type OwnerScopeDeps = {
  enabled: () => boolean;
  /** Resolves the signed-in user from a verified server-side session; anonymous on any error (fail closed). */
  principal: (request: Request) => Promise<Principal>;
  repo: OwnerRepo;
  capabilities: CapabilityStore;
  now: () => Date;
  /** Per-client limiter for capability exchanges and public reads. */
  limit: (request: Request, bucket: 'capability' | 'public') => { allowed: boolean; retryAfterSeconds: number };
  /** Compatibility bridge for confirmation URLs issued before capabilities (off when LEGACY_BOOKING_LINKS=0). */
  legacyBookingLinks: () => boolean;
  auditSink?: (line: string) => void;
};

const BASE_HEADERS = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...BASE_HEADERS, ...extra } });

/** The deployment switch. Off unless OWNER_SCOPE_API=1 (set only after the schema migration is approved and applied). */
export const ownerScopeEnabled = () => process.env.OWNER_SCOPE_API === '1';
export const ownerScopeDisabled = () => json({ error: 'The owner-scoped API is not enabled on this deployment.' }, 503);

const NOT_FOUND = 'Not found.';
const INVALID_LINK = 'This link is not valid or has expired. Ask the organiser for a new one.';

async function safePrincipal(deps: OwnerScopeDeps, request: Request): Promise<Principal> {
  try {
    const p = await deps.principal(request);
    return p && p.kind === 'user' && typeof p.authUserId === 'string' && UUID.test(p.authUserId) ? p : { kind: 'anonymous' };
  } catch {
    return { kind: 'anonymous' };
  }
}

type Ctx = { deps: OwnerScopeDeps; requestId: string; action: string; actor: string | null; eventId?: string | null; resource?: string | null };
function respond(ctx: Ctx, status: number, body: unknown, extra: Record<string, string> = {}) {
  audit({ action: ctx.action, result: status < 400 ? 'allowed' : status >= 500 ? 'error' : 'denied', status, actor: ctx.actor, eventId: ctx.eventId, resource: ctx.resource, requestId: ctx.requestId }, ctx.deps.auditSink);
  return json(body, status, { 'X-Request-Id': ctx.requestId, ...extra });
}
function outcome<T>(ctx: Ctx, r: WriteOutcome<T>, okStatus = 200): Response {
  switch (r.kind) {
    case 'ok': return respond(ctx, okStatus, r.value);
    case 'not-found': return respond(ctx, 404, { error: NOT_FOUND });
    case 'forbidden': return respond(ctx, 403, { error: 'Your access to this event is read-only.' });
    case 'conflict': return respond(ctx, 409, { error: r.message });
    case 'invalid': return respond(ctx, 400, { error: r.message });
    default: {
      const unreachable: never = r;
      return respond(ctx, 500, { error: `Unhandled outcome ${String(unreachable)}` });
    }
  }
}

/** Shared prologue for cookie-authenticated writes. Returns a Response to send, or the verified user and body. */
type Prologue = { done: Response } | { ctx: Ctx; user: string; body: unknown };
async function writePrologue(deps: OwnerScopeDeps, request: Request, action: string, needsBody = true): Promise<Prologue> {
  const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action, actor: null };
  const origin = sameOriginCheck(request);
  if (!origin.ok) return { done: respond(ctx, 403, { error: origin.reason }) };
  const principal = await safePrincipal(deps, request);
  if (principal.kind !== 'user') return { done: respond(ctx, 401, { error: 'Sign in to manage events.' }) };
  ctx.actor = principal.authUserId;
  let body: unknown = {};
  if (needsBody) {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return { done: respond(ctx, parsed.error.includes('too large') ? 413 : 400, { error: parsed.error }) };
    body = parsed.value;
  }
  return { ctx, user: principal.authUserId, body };
}

/** GET /api/v2/events: the signed-in user's events with their role on each. */
export function listEventsHandler(deps: OwnerScopeDeps) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const principal = await safePrincipal(deps, request);
    const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action: 'event.list', actor: principal.kind === 'user' ? principal.authUserId : null };
    const d = decide('event:list', principal);
    if (!d.allow) return respond(ctx, d.status, { error: d.reason });
    return respond(ctx, 200, { events: await deps.repo.listEvents((principal as { authUserId: string }).authUserId) });
  };
}

/** GET /api/v2/events/{eventId}: full event (guests, bookings, rooms, rules) for members; 404 for everyone else. */
export function getEventHandler(deps: OwnerScopeDeps) {
  return async (request: Request, eventId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const principal = await safePrincipal(deps, request);
    const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action: 'event.read', actor: principal.kind === 'user' ? principal.authUserId : null, eventId: UUID.test(eventId) ? eventId : null };
    if (principal.kind !== 'user') return respond(ctx, 401, { error: 'Sign in to manage events.' });
    const found = UUID.test(eventId) ? await deps.repo.getEvent(principal.authUserId, eventId) : null;
    const d = decide('event:read', principal, { exists: !!found, role: found?.role ?? null });
    if (!d.allow) return respond(ctx, d.status, { error: d.reason });
    return respond(ctx, 200, { event: found!.event, role: found!.role });
  };
}

/** PATCH /api/v2/events/{eventId}: allowlisted event fields, for owners and editors. */
export function patchEventHandler(deps: OwnerScopeDeps) {
  return async (request: Request, eventId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'event.update');
    if ('done' in p) return p.done;
    p.ctx.eventId = UUID.test(eventId) ? eventId : null;
    if (!UUID.test(eventId)) return respond(p.ctx, 404, { error: NOT_FOUND });
    const v = validateEventPatch(p.body);
    if (!v.ok) return respond(p.ctx, 400, { error: v.error });
    return outcome(p.ctx, await deps.repo.updateEvent(p.user, eventId, v.value));
  };
}

/** POST /api/v2/events/{eventId}/status: the legacy transition table, applied as a compare-and-set. */
export function eventStatusHandler(deps: OwnerScopeDeps) {
  return async (request: Request, eventId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'event.status');
    if ('done' in p) return p.done;
    p.ctx.eventId = UUID.test(eventId) ? eventId : null;
    if (!UUID.test(eventId)) return respond(p.ctx, 404, { error: NOT_FOUND });
    const v = validateStatusChange(p.body);
    if (!v.ok) return respond(p.ctx, 400, { error: v.error });
    return outcome(p.ctx, await deps.repo.changeStatus(p.user, eventId, v.value.status));
  };
}

/** GET /api/v2/guests?eventId=…: guests of one event, for its members only. */
export function listGuestsHandler(deps: OwnerScopeDeps) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const principal = await safePrincipal(deps, request);
    const eventId = new URL(request.url).searchParams.get('eventId') ?? '';
    const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action: 'guest.list', actor: principal.kind === 'user' ? principal.authUserId : null, eventId: UUID.test(eventId) ? eventId : null };
    if (principal.kind !== 'user') return respond(ctx, 401, { error: 'Sign in to manage events.' });
    if (!UUID.test(eventId)) return respond(ctx, 400, { error: 'eventId must be an event id.' });
    const guests = await deps.repo.listGuests(principal.authUserId, eventId);
    if (!guests) return respond(ctx, 404, { error: NOT_FOUND });
    return respond(ctx, 200, { eventId, guests });
  };
}

/** POST /api/v2/guests: add a guest to an event the user can edit. */
export function createGuestHandler(deps: OwnerScopeDeps) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'guest.create');
    if ('done' in p) return p.done;
    const v = validateGuestCreate(p.body);
    if (!v.ok) return respond(p.ctx, 400, { error: v.error });
    p.ctx.eventId = v.value.eventId;
    const r = await deps.repo.createGuest(p.user, v.value.eventId, v.value.guest);
    if (r.kind === 'ok') p.ctx.resource = String((r.value as { id: string }).id);
    return outcome(p.ctx, r, 201);
  };
}

/** PATCH /api/v2/guests/{guestId}: allowlisted guest fields; the guest must belong to an event the user can edit. */
export function patchGuestHandler(deps: OwnerScopeDeps) {
  return async (request: Request, guestId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'guest.update');
    if ('done' in p) return p.done;
    p.ctx.resource = guestId;
    if (!UUID.test(guestId)) return respond(p.ctx, 404, { error: NOT_FOUND });
    const v = validateGuestPatch(p.body);
    if (!v.ok) return respond(p.ctx, 400, { error: v.error });
    const r = await deps.repo.updateGuest(p.user, guestId, v.value.eventId, v.value.patch);
    if (r.kind === 'ok') p.ctx.eventId = r.value.eventId;
    return outcome(p.ctx, r);
  };
}

/** DELETE /api/v2/guests/{guestId}[?eventId=…]: refuses while the guest holds an active booking (capacity stays right). */
export function deleteGuestHandler(deps: OwnerScopeDeps) {
  return async (request: Request, guestId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'guest.delete', false);
    if ('done' in p) return p.done;
    p.ctx.resource = guestId;
    const eventId = new URL(request.url).searchParams.get('eventId') ?? undefined;
    if (!UUID.test(guestId) || (eventId !== undefined && !UUID.test(eventId))) return respond(p.ctx, 404, { error: NOT_FOUND });
    const r = await deps.repo.deleteGuest(p.user, guestId, eventId);
    if (r.kind === 'ok') p.ctx.eventId = r.value.eventId;
    return outcome(p.ctx, r);
  };
}

/**
 * GET /api/v2/bookings/{bookingId}: event members see the full booking; a booking-session holder sees their own
 * booking (guest name only). A bare booking id is NOT authority: without a role or a session bound to this booking,
 * anonymous callers get 401 and signed-in non-members 404, whether or not the booking exists.
 */
export function getBookingHandler(deps: OwnerScopeDeps) {
  return async (request: Request, bookingId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const principal = await safePrincipal(deps, request);
    const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action: 'booking.read', actor: principal.kind === 'user' ? principal.authUserId : null, resource: bookingId };
    const valid = UUID.test(bookingId);
    const role = valid && principal.kind === 'user' ? await deps.repo.roleOnBooking(principal.authUserId, bookingId) : null;
    const session = valid ? await deps.capabilities.resolveSession(readSessionCookie(request), deps.now()) : null;
    const d = decide('booking:read', principal, { exists: valid, role, bookingSession: !!session && session.bookingId === bookingId });
    if (!d.allow) return respond(ctx, d.status, { error: d.status === 401 ? d.reason : NOT_FOUND });
    if (d.scope === 'owner') {
      const b = await deps.repo.getBookingForMember((principal as { authUserId: string }).authUserId, bookingId);
      if (!b) return respond(ctx, 404, { error: NOT_FOUND });
      const { event, ...booking } = b;
      ctx.eventId = b.eventId;
      return respond(ctx, 200, { scope: 'owner', booking, event: publicEventView(event) });
    }
    const b = await deps.repo.getBookingForHolder(bookingId);
    if (!b) return respond(ctx, 404, { error: NOT_FOUND });
    return respond(ctx, 200, { scope: 'booking-holder', booking: bookingHolderView(b, b.event, session!.scope) });
  };
}

/** POST /api/v2/bookings/{bookingId}/access: the event OWNER issues a booking link (token shown once, in the fragment). */
export function issueBookingAccessHandler(deps: OwnerScopeDeps) {
  return async (request: Request, bookingId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'booking.access.issue', request.headers.get('content-length') !== '0' && request.body !== null);
    if ('done' in p) return p.done;
    p.ctx.resource = bookingId;
    if (!UUID.test(bookingId)) return respond(p.ctx, 404, { error: NOT_FOUND });
    const v = validateAccessGrant(p.body);
    if (!v.ok) return respond(p.ctx, 400, { error: v.error });
    const eventId = await deps.repo.bookingEventForAdmin(p.user, bookingId);
    if (!eventId) return (await deps.repo.roleOnBooking(p.user, bookingId)) ? respond(p.ctx, 403, { error: 'Only the event owner can issue booking links.' }) : respond(p.ctx, 404, { error: NOT_FOUND });
    p.ctx.eventId = eventId;
    const now = deps.now();
    const { token, expiresAt } = await deps.capabilities.issueLink(bookingId, v.value.scope, new Date(now.getTime() + v.value.expiresInDays * 86_400_000), now);
    return respond(p.ctx, 201, { url: `${requestOrigin(request) ?? ''}/booking/access#${token}`, scope: v.value.scope, expiresAt });
  };
}

/** DELETE /api/v2/bookings/{bookingId}/access: revokes every link AND session of the booking immediately. */
export function revokeBookingAccessHandler(deps: OwnerScopeDeps) {
  return async (request: Request, bookingId: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await writePrologue(deps, request, 'booking.access.revoke', false);
    if ('done' in p) return p.done;
    p.ctx.resource = bookingId;
    if (!UUID.test(bookingId)) return respond(p.ctx, 404, { error: NOT_FOUND });
    const eventId = await deps.repo.bookingEventForAdmin(p.user, bookingId);
    if (!eventId) return (await deps.repo.roleOnBooking(p.user, bookingId)) ? respond(p.ctx, 403, { error: 'Only the event owner can revoke booking links.' }) : respond(p.ctx, 404, { error: NOT_FOUND });
    p.ctx.eventId = eventId;
    return respond(p.ctx, 200, { revoked: await deps.capabilities.revokeAll(bookingId, deps.now()) });
  };
}

/** GET /api/v2/public/events/{slug}: the share-link view (public fields of an active or published event). */
export function publicEventHandler(deps: OwnerScopeDeps) {
  return async (request: Request, slug: string): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action: 'event.read-public', actor: null };
    const limited = deps.limit(request, 'public');
    if (!limited.allowed) return respond(ctx, 429, { error: 'Too many requests.' }, { 'Retry-After': String(limited.retryAfterSeconds) });
    const event = /^[A-Za-z0-9-]{1,160}$/.test(slug) ? await deps.repo.getPublicEvent(slug) : null;
    const d = decide('event:read-public', { kind: 'anonymous' }, { exists: !!event, eventStatus: event?.status });
    if (!d.allow) return respond(ctx, d.status, { error: NOT_FOUND });
    return respond(ctx, 200, { event: publicEventView(event!) });
  };
}

type CapabilityPrologue = { done: Response } | { ctx: Ctx; body: Record<string, unknown> | null };
async function capabilityPrologue(deps: OwnerScopeDeps, request: Request, action: string): Promise<CapabilityPrologue> {
  const ctx: Ctx = { deps, requestId: crypto.randomUUID(), action, actor: null };
  const origin = sameOriginCheck(request);
  if (!origin.ok) return { done: respond(ctx, 403, { error: origin.reason }) };
  const limited = deps.limit(request, 'capability');
  if (!limited.allowed) return { done: respond(ctx, 429, { error: 'Too many attempts. Try again shortly.' }, { 'Retry-After': String(limited.retryAfterSeconds) }) };
  const parsed = await readJsonBody(request, 2048);
  if (!parsed.ok) return { done: respond(ctx, 400, { error: parsed.error }) };
  return { ctx, body: parsed.value as Record<string, unknown> };
}
const isHttps = (request: Request) => (request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')) === 'https';

/** POST /api/v2/booking-access/exchange {token}: a valid link becomes an HttpOnly session for that booking. */
export function exchangeLinkHandler(deps: OwnerScopeDeps) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    const p = await capabilityPrologue(deps, request, 'booking.access.exchange');
    if ('done' in p) return p.done;
    const token = typeof p.body?.token === 'string' ? p.body.token : '';
    const r = await deps.capabilities.exchangeLink(token, deps.now());
    if (!r) return respond(p.ctx, 404, { error: INVALID_LINK });
    p.ctx.resource = r.bookingId;
    return respond(p.ctx, 200, { bookingId: r.bookingId, scope: r.scope, expiresAt: r.expiresAt }, { 'Set-Cookie': sessionCookie(r.token, r.expiresAt, isHttps(request)) });
  };
}

/**
 * POST /api/v2/booking-access/legacy {bookingId}: compatibility bridge that keeps confirmation URLs sent before
 * capabilities working. View-only, 2-hour session, audited, rate-limited, and switchable off (LEGACY_BOOKING_LINKS=0).
 */
export function legacyBookingLinkHandler(deps: OwnerScopeDeps) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return ownerScopeDisabled();
    if (!deps.legacyBookingLinks()) return json({ error: INVALID_LINK }, 410);
    const p = await capabilityPrologue(deps, request, 'booking.access.legacy');
    if ('done' in p) return p.done;
    const bookingId = typeof p.body?.bookingId === 'string' ? p.body.bookingId : '';
    p.ctx.resource = bookingId || null;
    const r = UUID.test(bookingId) ? await deps.capabilities.legacySession(bookingId, deps.now()) : null;
    if (!r) return respond(p.ctx, 404, { error: INVALID_LINK });
    return respond(p.ctx, 200, { bookingId: r.bookingId, scope: r.scope, expiresAt: r.expiresAt, legacy: true }, { 'Set-Cookie': sessionCookie(r.token, r.expiresAt, isHttps(request)) });
  };
}
