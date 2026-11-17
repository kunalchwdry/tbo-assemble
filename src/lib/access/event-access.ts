/**
 * Owner-scoped access policy for events, guests and bookings: the replacement for the legacy unauthenticated
 * /api/events, /api/guests and /api/bookings routes (docs/security/event-ownership.md).
 *
 * Ownership is EVENT-LEVEL: an `EventMember` row grants one verified Supabase user a role on one event
 * (owner/editor/viewer). Events without an active membership are UNCLAIMED and never appear in the owner-scoped API;
 * they stay reachable only through the legacy routes and their public links until an owner is chosen.
 *
 * Capabilities: a public event slug grants the published event's public fields only. A booking capability (an issued
 * link or, during the transition, a legacy booking URL) is exchanged for an HttpOnly session bound to ONE booking.
 * A bare booking id in a URL path is never accepted as authority by the v2 API.
 *
 * Status codes: 401 when an owner-only endpoint is called without a valid session (whether or not the resource exists);
 * 404 when a signed-in user asks for something that does not exist OR that they have no role on (no enumeration);
 * 403 only when the user can already see the event (viewer) but may not change it.
 *
 * This module is pure (no I/O). The data-access layer (owner-repo.ts) enforces the same rules inside every query, so
 * a mistake in a handler cannot widen access on its own.
 */

export type Principal = { kind: 'anonymous' } | { kind: 'user'; authUserId: string };
export type Role = 'owner' | 'editor' | 'viewer';

export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'];
export const READ_ROLES: readonly Role[] = ['owner', 'editor', 'viewer'];
export const WRITE_ROLES: readonly Role[] = ['owner', 'editor'];
export const ACCESS_ADMIN_ROLES: readonly Role[] = ['owner'];

export type Action =
  | 'event:list' | 'event:read' | 'event:write'
  | 'guest:list' | 'guest:write'
  | 'booking:read' | 'booking:access-admin'
  | 'event:read-public';

export type Target = {
  /** False when the event (or booking) does not exist. */
  exists: boolean;
  /** The principal's active role on the event; null/undefined when they have none (includes unclaimed events). */
  role?: Role | null;
  /** A valid booking session (from an exchanged capability) bound to THIS booking was presented. */
  bookingSession?: boolean;
  /** Event status, for public reads. */
  eventStatus?: string;
};

export type Decision =
  | { allow: true; scope: 'owner' | 'public' | 'booking-holder' }
  | { allow: false; status: 401 | 403 | 404; reason: string };

const deny = (status: 401 | 403 | 404, reason: string): Decision => ({ allow: false, status, reason });
const has = (roles: readonly Role[], role: Role | null | undefined) => !!role && roles.includes(role);

const REQUIRED_ROLES: Partial<Record<Action, readonly Role[]>> = {
  'event:read': READ_ROLES,
  'guest:list': READ_ROLES,
  'event:write': WRITE_ROLES,
  'guest:write': WRITE_ROLES,
  'booking:access-admin': ACCESS_ADMIN_ROLES,
};

/** Statuses whose public page and booking flow are open to anyone with the share link. */
export const PUBLIC_EVENT_STATUSES: readonly string[] = ['active', 'published'];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The single authorization decision used by every v2 handler. Pure; unit-tested. */
export function decide(action: Action, principal: Principal, target: Target = { exists: true }): Decision {
  if (action === 'event:read-public') {
    return target.exists && target.eventStatus !== undefined && PUBLIC_EVENT_STATUSES.includes(target.eventStatus)
      ? { allow: true, scope: 'public' } : deny(404, 'Not found.');
  }
  if (action === 'booking:read') {
    if (!target.exists) return deny(404, 'Not found.');
    if (principal.kind === 'user' && has(READ_ROLES, target.role)) return { allow: true, scope: 'owner' };
    if (target.bookingSession) return { allow: true, scope: 'booking-holder' };
    return principal.kind === 'user' ? deny(404, 'Not found.') : deny(401, 'Open your booking link again to view this booking.');
  }
  if (principal.kind !== 'user') return deny(401, 'Sign in to manage events.');
  if (action === 'event:list') return { allow: true, scope: 'owner' }; // the repository returns only the user's events
  const required = REQUIRED_ROLES[action];
  if (!required || !target.exists || !target.role) return deny(404, 'Not found.');
  if (!has(required, target.role)) return has(READ_ROLES, target.role) ? deny(403, 'Your access to this event is read-only.') : deny(404, 'Not found.');
  return { allow: true, scope: 'owner' };
}

type RoomBlockLike = { id: string; roomType: string; description?: string | null; rate: number; totalQty: number; bookedQty: number; hotelName?: string | null };
type AddOnLike = { id: string; name: string; description?: string | null; price: number; isIncluded?: boolean };
export type EventLike = {
  /** Not part of the public view: the slug is the public identifier, and legacy routes accept raw event ids. */
  id?: string; name: string; slug: string; type: string; venue: string; location: string; checkIn: Date | string; checkOut: Date | string;
  description?: string | null; primaryColor?: string; secondaryColor?: string; accentColor?: string; heroImageUrl?: string | null; status?: string;
  roomBlocks?: RoomBlockLike[]; addOns?: AddOnLike[];
  [key: string]: unknown;
};

/** Fields a share-link or booking holder may see. Everything else (guests, bookings, rules, agent, logs) is dropped. */
export const PUBLIC_EVENT_FIELDS = ['name', 'slug', 'type', 'venue', 'location', 'checkIn', 'checkOut', 'description', 'primaryColor', 'secondaryColor', 'accentColor', 'heroImageUrl', 'status'] as const;

/** Allowlisted public event view. Built from explicit fields, so a new column never leaks by default. */
export function publicEventView(event: EventLike) {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_EVENT_FIELDS) if (event[key] !== undefined) out[key] = event[key];
  out.roomBlocks = (event.roomBlocks ?? []).map(r => ({ id: r.id, roomType: r.roomType, description: r.description ?? null, rate: r.rate, available: Math.max(0, r.totalQty - r.bookedQty), hotelName: r.hotelName ?? null }));
  out.addOns = (event.addOns ?? []).map(a => ({ id: a.id, name: a.name, description: a.description ?? null, price: a.price, isIncluded: a.isIncluded ?? false }));
  return out;
}

type BookingLike = { id: string; eventId: string; roomBlockId?: string; totalAmount: number; status: string; checkedIn?: boolean; checkedInAt?: Date | string | null; createdAt?: Date | string; guest?: { name?: string; email?: string | null; phone?: string | null } | null; [key: string]: unknown };

/** A booking as its holder sees it: their own booking and guest name, never other guests, contact data or internal ids. */
export function bookingHolderView(booking: BookingLike, event: EventLike, scope: 'view' | 'upgrade' = 'view') {
  return {
    id: booking.id, status: booking.status, totalAmount: booking.totalAmount, checkedIn: booking.checkedIn ?? false, checkedInAt: booking.checkedInAt ?? null, createdAt: booking.createdAt ?? null,
    roomBlockId: booking.roomBlockId ?? null, guest: booking.guest ? { name: booking.guest.name ?? null } : null,
    allowedActions: scope === 'upgrade' ? ['view', 'upgrade'] : ['view'],
    event: publicEventView(event),
  };
}
