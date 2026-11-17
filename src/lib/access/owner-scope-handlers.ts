/**
 * Owner-scoped read API (v2) as handler factories. Dependencies (session, data access, feature switch) are injected,
 * so authorization and denial paths are tested with local mocks only (tests/owner-scope.test.ts). The Next.js routes
 * under src/app/api/v2 wire in the real dependencies (owner-scope-deps.ts).
 *
 * Disabled by default: every handler answers 503 until OWNER_SCOPE_API=1 is set AFTER the ownership migration has been
 * approved and applied. The legacy routes are not changed by this module.
 */
import { decide, publicEventView, bookingHolderView, UUID, type EventLike, type Principal } from './event-access';

export type OwnedEvent = { event: EventLike; ownerAuthUserId: string | null };
export type OwnerScopeDeps = {
  enabled: () => boolean;
  /** Resolves the signed-in user; must return anonymous on any auth error (fail closed). */
  principal: (request: Request) => Promise<Principal>;
  /** Events whose agent is linked to this user (summary fields only). */
  listOwnedEvents: (authUserId: string) => Promise<EventLike[]>;
  /** One event with room blocks, add-ons and the owner link; `withGuests` adds guests and bookings (owner view). */
  getEvent: (eventId: string, withGuests: boolean) => Promise<OwnedEvent | null>;
  listGuests: (eventId: string) => Promise<Record<string, unknown>[]>;
  getBooking: (bookingId: string) => Promise<{ booking: Record<string, unknown> & { id: string; eventId: string; totalAmount: number; status: string }; event: OwnedEvent } | null>;
};

const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** The deployment switch. Off unless OWNER_SCOPE_API=1 (set only after the ownership migration is approved and applied). */
export const ownerScopeEnabled = () => process.env.OWNER_SCOPE_API === '1';
export const ownerScopeDisabled = () => json({ error: 'The owner-scoped API is not enabled on this deployment.' }, 503);
const disabled = ownerScopeDisabled;
const fail = (status: number, reason: string) => json({ error: reason }, status);

async function safePrincipal(deps: OwnerScopeDeps, request: Request): Promise<Principal> {
  try {
    const p = await deps.principal(request);
    return p && p.kind === 'user' && typeof p.authUserId === 'string' && UUID.test(p.authUserId) ? p : { kind: 'anonymous' };
  } catch {
    return { kind: 'anonymous' };
  }
}

/** GET /api/v2/events — the signed-in user's events. */
export function listEventsHandler(deps: OwnerScopeDeps) {
  return async (request: Request) => {
    if (!deps.enabled()) return disabled();
    const principal = await safePrincipal(deps, request);
    const d = decide('event:list', principal);
    if (!d.allow) return fail(d.status, d.reason);
    const events = await deps.listOwnedEvents((principal as { authUserId: string }).authUserId);
    return json({ events });
  };
}

/** GET /api/v2/events/{eventId} — full event for its owner (guests and bookings included); 404 for everyone else. */
export function getEventHandler(deps: OwnerScopeDeps) {
  return async (request: Request, eventId: string) => {
    if (!deps.enabled()) return disabled();
    const principal = await safePrincipal(deps, request);
    if (principal.kind !== 'user') return fail(401, 'Sign in to manage events.');
    const found = UUID.test(eventId) ? await deps.getEvent(eventId, true) : null;
    const d = decide('event:read', principal, { exists: !!found, ownerAuthUserId: found?.ownerAuthUserId ?? null });
    if (!d.allow) return fail(d.status, d.reason);
    return json({ event: found!.event });
  };
}

/** GET /api/v2/guests?eventId=… — guests of one event, for its owner only. */
export function listGuestsHandler(deps: OwnerScopeDeps) {
  return async (request: Request) => {
    if (!deps.enabled()) return disabled();
    const principal = await safePrincipal(deps, request);
    if (principal.kind !== 'user') return fail(401, 'Sign in to manage events.');
    const eventId = new URL(request.url).searchParams.get('eventId') ?? '';
    if (!UUID.test(eventId)) return fail(400, 'eventId must be an event id.');
    const found = await deps.getEvent(eventId, false);
    const d = decide('guest:list', principal, { exists: !!found, ownerAuthUserId: found?.ownerAuthUserId ?? null });
    if (!d.allow) return fail(d.status, d.reason);
    return json({ eventId, guests: await deps.listGuests(eventId) });
  };
}

/**
 * GET /api/v2/bookings/{bookingId} — the booking confirmation link. The booking id is the capability: its holder sees
 * that booking and the event's public data (room types and availability for upgrades), never other guests. The
 * event's owner sees the full booking.
 */
export function getBookingHandler(deps: OwnerScopeDeps) {
  return async (request: Request, bookingId: string) => {
    if (!deps.enabled()) return disabled();
    if (!UUID.test(bookingId)) return fail(404, 'Not found.');
    const principal = await safePrincipal(deps, request);
    const found = await deps.getBooking(bookingId);
    const d = decide('booking:read', principal, { exists: !!found, ownerAuthUserId: found?.event.ownerAuthUserId ?? null, bookingMatches: !!found && found.booking.id === bookingId });
    if (!d.allow) return fail(d.status, d.reason);
    if (d.scope === 'owner') return json({ booking: found!.booking, event: publicEventView(found!.event.event), scope: 'owner' });
    return json({ booking: bookingHolderView(found!.booking, found!.event.event), scope: 'booking-holder' });
  };
}
