/**
 * Owner-scoped access policy for events, guests and bookings: the replacement for the legacy unauthenticated
 * /api/events, /api/guests and /api/bookings routes (see docs/security/owner-scoped-migration.md).
 *
 * Ownership: an event belongs to the signed-in Supabase user linked to its Agent (`Agent.authUserId`, added by the
 * DRAFT docs/security/ownership-migration.sql). Events whose agent has no linked user are UNCLAIMED. Nothing in the
 * owner-scoped API reveals or changes an unclaimed event; until an owner is chosen they stay reachable only through
 * the legacy routes and their public share links, exactly as today.
 *
 * Capabilities: a public share link (event slug) and a booking id (random UUID v4, 122 bits) each grant a narrow view:
 * the event's public page data, or that one booking. Neither ever exposes guest lists, other bookings, internal
 * rules or the agent.
 *
 * Status codes: 401 when an owner-only endpoint is called without a session (independent of whether the resource
 * exists); 404 when a signed-in user asks for something that does not exist OR is not theirs (no enumeration).
 */

export type Principal = { kind: 'anonymous' } | { kind: 'user'; authUserId: string };

export type Action =
  | 'event:list' | 'event:read' | 'event:write'
  | 'guest:list' | 'guest:write'
  | 'event:read-public' | 'booking:read' | 'booking:create' | 'booking:write';

export type Target = {
  /** False when the event (or booking) does not exist. */
  exists: boolean;
  /** Linked owner of the event; null for unclaimed (legacy) events. */
  ownerAuthUserId?: string | null;
  /** The request presented this event's public slug (share link). */
  slugMatches?: boolean;
  /** The request presented this booking's id (booking confirmation link). */
  bookingMatches?: boolean;
  /** Event status; public booking needs a published event. */
  eventStatus?: string;
};

export type Decision =
  | { allow: true; scope: 'owner' | 'public' | 'booking-holder' }
  | { allow: false; status: 401 | 403 | 404; reason: string };

const OWNER_ONLY: ReadonlySet<Action> = new Set(['event:list', 'event:read', 'event:write', 'guest:list', 'guest:write', 'booking:write']);
const deny = (status: 401 | 403 | 404, reason: string): Decision => ({ allow: false, status, reason });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The single authorization decision used by every owner-scoped handler. Pure; unit-tested with mocks. */
export function decide(action: Action, principal: Principal, target: Target = { exists: true }): Decision {
  const owner = principal.kind === 'user' && !!target.ownerAuthUserId && target.ownerAuthUserId === principal.authUserId;
  if (OWNER_ONLY.has(action)) {
    if (principal.kind !== 'user') return deny(401, 'Sign in to manage events.');
    if (action === 'event:list') return { allow: true, scope: 'owner' }; // collection: the repository returns only the user's events
    if (!target.exists || !owner) return deny(404, 'Not found.');
    return { allow: true, scope: 'owner' };
  }
  if (!target.exists) return deny(404, 'Not found.');
  switch (action) {
    case 'event:read-public':
      if (owner) return { allow: true, scope: 'owner' };
      return target.slugMatches || target.bookingMatches ? { allow: true, scope: 'public' } : deny(404, 'Not found.');
    case 'booking:read':
      if (owner) return { allow: true, scope: 'owner' };
      return target.bookingMatches ? { allow: true, scope: 'booking-holder' } : deny(404, 'Not found.');
    case 'booking:create':
      if (!target.slugMatches) return deny(404, 'Not found.');
      return target.eventStatus === undefined || target.eventStatus === 'published' || target.eventStatus === 'active' ? { allow: true, scope: 'public' } : deny(403, 'This event is not open for booking.');
    default:
      return deny(403, 'Not allowed.');
  }
}

type RoomBlockLike = { id: string; roomType: string; description?: string | null; rate: number; totalQty: number; bookedQty: number; hotelName?: string | null };
type AddOnLike = { id: string; name: string; description?: string | null; price: number };
export type EventLike = {
  id: string; name: string; slug: string; type: string; venue: string; location: string; checkIn: Date | string; checkOut: Date | string;
  description?: string | null; primaryColor?: string; secondaryColor?: string; accentColor?: string; heroImageUrl?: string | null; status?: string;
  roomBlocks?: RoomBlockLike[]; addOns?: AddOnLike[];
  [key: string]: unknown;
};

/** Fields a share-link or booking holder may see. Everything else (guests, bookings, rules, agent, logs) is dropped. */
export const PUBLIC_EVENT_FIELDS = ['id', 'name', 'slug', 'type', 'venue', 'location', 'checkIn', 'checkOut', 'description', 'primaryColor', 'secondaryColor', 'accentColor', 'heroImageUrl', 'status'] as const;

export function publicEventView(event: EventLike) {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_EVENT_FIELDS) if (event[key] !== undefined) out[key] = event[key];
  out.roomBlocks = (event.roomBlocks ?? []).map(r => ({ id: r.id, roomType: r.roomType, description: r.description ?? null, rate: r.rate, totalQty: r.totalQty, bookedQty: r.bookedQty, available: Math.max(0, r.totalQty - r.bookedQty), hotelName: r.hotelName ?? null }));
  out.addOns = (event.addOns ?? []).map(a => ({ id: a.id, name: a.name, description: a.description ?? null, price: a.price }));
  return out;
}

type BookingLike = { id: string; guestId?: string; eventId: string; roomBlockId?: string; totalAmount: number; status: string; checkedIn?: boolean; checkedInAt?: Date | string | null; createdAt?: Date | string; guest?: { name?: string; email?: string | null; phone?: string | null } | null; [key: string]: unknown };

/** A booking as its holder sees it: their own booking and guest name, never other guests or internal ids. */
export function bookingHolderView(booking: BookingLike, event: EventLike) {
  return {
    id: booking.id, status: booking.status, totalAmount: booking.totalAmount, checkedIn: booking.checkedIn ?? false, checkedInAt: booking.checkedInAt ?? null, createdAt: booking.createdAt ?? null,
    roomBlockId: booking.roomBlockId ?? null, guest: booking.guest ? { name: booking.guest.name ?? null } : null,
    event: publicEventView(event),
  };
}
