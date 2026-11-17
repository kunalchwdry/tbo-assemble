/**
 * Owner-scoped data access (plan Phase 1.4). Prisma connects with elevated credentials and bypasses RLS, so the
 * authorization rule is part of EVERY query here, not only of the handler that calls it:
 *
 *   * reads filter by the record id AND an active EventMember row for the verified user;
 *   * updates and deletes put the same membership condition in the WHERE clause of the write itself (updateMany /
 *     deleteMany), so ownership is never checked once and then written by id alone;
 *   * inserts run in a transaction that first locks the membership row (FOR SHARE), so a concurrent revocation waits
 *     until the insert commits;
 *   * child ids (guest, booking) must belong to an event the user is a member of; an explicit eventId must match.
 *
 * The client is injected, so the same code runs against the isolated test database (tests/owner-scope-db.test.ts).
 */
import type { PrismaClient } from '@/generated/prisma/client';
import { READ_ROLES, WRITE_ROLES, type Role } from './event-access';
import { canTransition, type EventPatch, type GuestFields } from './validate';

type Db = PrismaClient;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

const membership = (authUserId: string, roles: readonly Role[]) => ({ some: { authUserId, revokedAt: null, role: { in: [...roles] } } });

const EVENT_SUMMARY = { id: true, name: true, slug: true, type: true, venue: true, location: true, checkIn: true, checkOut: true, status: true, expectedPax: true } as const;
const EVENT_DETAIL = {
  ...EVENT_SUMMARY, description: true, primaryColor: true, secondaryColor: true, accentColor: true, heroImageUrl: true, createdAt: true, updatedAt: true,
  roomBlocks: { orderBy: { roomType: 'asc' } }, addOns: true, attritionRules: { orderBy: { releaseDate: 'asc' } },
  guests: { orderBy: { name: 'asc' } }, bookings: { orderBy: { createdAt: 'asc' } },
} as const;
const GUEST_FIELDS = { id: true, eventId: true, name: true, email: true, phone: true, group: true, status: true, proximityRequest: true, notes: true, allocatedFloor: true, allocatedWing: true, allocatedRoom: true, createdAt: true, updatedAt: true } as const;

export type WriteOutcome<T = undefined> =
  | { kind: 'ok'; value: T }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'conflict'; message: string }
  | { kind: 'invalid'; message: string };

export function ownerRepo(db: Db) {
  async function roleOn(authUserId: string, eventId: string, tx: Tx | Db = db): Promise<Role | null> {
    const m = await tx.eventMember.findFirst({ where: { eventId, authUserId, revokedAt: null }, select: { role: true } });
    return m && (READ_ROLES as readonly string[]).includes(m.role) ? (m.role as Role) : null;
  }

  /** Locks the caller's write membership for the rest of the transaction; false when there is none. */
  async function lockWriteMembership(tx: Tx, authUserId: string, eventId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM "EventMember"
      WHERE "eventId" = ${eventId} AND "authUserId" = ${authUserId}::uuid AND "revokedAt" IS NULL AND role = ANY(${[...WRITE_ROLES]}::text[])
      FOR SHARE`;
    return rows.length === 1;
  }

  async function writeTarget(authUserId: string, eventId: string): Promise<WriteOutcome<Role>> {
    const role = await roleOn(authUserId, eventId);
    if (!role) return { kind: 'not-found' };
    if (!(WRITE_ROLES as readonly string[]).includes(role)) return { kind: 'forbidden' };
    return { kind: 'ok', value: role };
  }

  return {
    roleOn,

    async listEvents(authUserId: string) {
      const events = await db.event.findMany({
        where: { members: membership(authUserId, READ_ROLES) }, orderBy: { checkIn: 'asc' },
        select: { ...EVENT_SUMMARY, members: { where: { authUserId, revokedAt: null }, select: { role: true } } },
      });
      return events.map(({ members, ...e }) => ({ ...e, role: members[0]?.role ?? null }));
    },

    async getEvent(authUserId: string, eventId: string) {
      const event = await db.event.findFirst({ where: { id: eventId, members: membership(authUserId, READ_ROLES) }, select: EVENT_DETAIL });
      if (!event) return null;
      return { event, role: await roleOn(authUserId, eventId) };
    },

    async listGuests(authUserId: string, eventId: string) {
      if (!(await roleOn(authUserId, eventId))) return null;
      return db.guest.findMany({ where: { eventId, event: { members: membership(authUserId, READ_ROLES) } }, orderBy: { name: 'asc' }, select: GUEST_FIELDS });
    },

    async updateEvent(authUserId: string, eventId: string, patch: EventPatch): Promise<WriteOutcome<{ id: string }>> {
      const target = await writeTarget(authUserId, eventId);
      if (target.kind !== 'ok') return target;
      return db.$transaction(async tx => {
        if ((patch.checkIn === undefined) !== (patch.checkOut === undefined)) {
          const current = await tx.event.findFirst({ where: { id: eventId, members: membership(authUserId, WRITE_ROLES) }, select: { checkIn: true, checkOut: true } });
          if (!current) return { kind: 'not-found' } as const;
          const checkIn = patch.checkIn ?? current.checkIn, checkOut = patch.checkOut ?? current.checkOut;
          if (checkOut < checkIn) return { kind: 'invalid', message: 'checkOut must not be before checkIn.' } as const;
        }
        const r = await tx.event.updateMany({ where: { id: eventId, members: membership(authUserId, WRITE_ROLES) }, data: patch });
        return r.count === 1 ? { kind: 'ok', value: { id: eventId } } as const : { kind: 'not-found' } as const;
      });
    },

    async changeStatus(authUserId: string, eventId: string, to: string): Promise<WriteOutcome<{ id: string; from: string; status: string }>> {
      const target = await writeTarget(authUserId, eventId);
      if (target.kind !== 'ok') return target;
      const current = await db.event.findFirst({ where: { id: eventId, members: membership(authUserId, WRITE_ROLES) }, select: { status: true } });
      if (!current) return { kind: 'not-found' };
      if (!canTransition(current.status, to)) return { kind: 'conflict', message: `An event cannot move from ${current.status} to ${to}.` };
      // Compare-and-set: applies only if the status is still the one validated above and the membership is still active.
      const r = await db.event.updateMany({ where: { id: eventId, status: current.status, members: membership(authUserId, WRITE_ROLES) }, data: { status: to } });
      return r.count === 1 ? { kind: 'ok', value: { id: eventId, from: current.status, status: to } } : { kind: 'conflict', message: 'The event changed meanwhile; reload and try again.' };
    },

    async createGuest(authUserId: string, eventId: string, guest: GuestFields & { name: string }): Promise<WriteOutcome<Record<string, unknown>>> {
      const target = await writeTarget(authUserId, eventId);
      if (target.kind !== 'ok') return target;
      return db.$transaction(async tx => {
        if (!(await lockWriteMembership(tx, authUserId, eventId))) return { kind: 'not-found' } as const;
        const created = await tx.guest.create({ data: { ...guest, eventId }, select: GUEST_FIELDS });
        return { kind: 'ok', value: created } as const;
      });
    },

    async updateGuest(authUserId: string, guestId: string, eventId: string | undefined, patch: GuestFields): Promise<WriteOutcome<{ id: string; eventId: string }>> {
      const found = await db.guest.findFirst({ where: { id: guestId, ...(eventId ? { eventId } : {}), event: { members: membership(authUserId, READ_ROLES) } }, select: { eventId: true } });
      if (!found) return { kind: 'not-found' };
      const target = await writeTarget(authUserId, found.eventId);
      if (target.kind !== 'ok') return target;
      const r = await db.guest.updateMany({ where: { id: guestId, eventId: found.eventId, event: { members: membership(authUserId, WRITE_ROLES) } }, data: patch });
      return r.count === 1 ? { kind: 'ok', value: { id: guestId, eventId: found.eventId } } : { kind: 'not-found' };
    },

    async deleteGuest(authUserId: string, guestId: string, eventId: string | undefined): Promise<WriteOutcome<{ id: string; eventId: string }>> {
      const found = await db.guest.findFirst({ where: { id: guestId, ...(eventId ? { eventId } : {}), event: { members: membership(authUserId, READ_ROLES) } }, select: { eventId: true } });
      if (!found) return { kind: 'not-found' };
      const target = await writeTarget(authUserId, found.eventId);
      if (target.kind !== 'ok') return target;
      return db.$transaction(async tx => {
        if (!(await lockWriteMembership(tx, authUserId, found.eventId))) return { kind: 'not-found' } as const;
        // Lock the guest row: a concurrent booking insert for this guest (FK lock) waits, so the check below stays true.
        await tx.$queryRaw`SELECT 1 FROM "Guest" WHERE id = ${guestId} FOR UPDATE`;
        const active = await tx.booking.count({ where: { guestId, status: { not: 'cancelled' } } });
        if (active > 0) return { kind: 'conflict', message: 'This guest has an active booking. Cancel it first so its room is released.' } as const;
        const r = await tx.guest.deleteMany({ where: { id: guestId, eventId: found.eventId, event: { members: membership(authUserId, WRITE_ROLES) } } });
        return r.count === 1 ? { kind: 'ok', value: { id: guestId, eventId: found.eventId } } as const : { kind: 'not-found' } as const;
      });
    },

    /** Owner view of one booking: only when the user has a role on the booking's event. */
    async getBookingForMember(authUserId: string, bookingId: string) {
      return db.booking.findFirst({
        where: { id: bookingId, event: { members: membership(authUserId, READ_ROLES) } },
        include: { guest: { select: { name: true, email: true, phone: true } }, addOns: true, event: { select: { ...EVENT_SUMMARY, description: true, primaryColor: true, secondaryColor: true, accentColor: true, heroImageUrl: true, roomBlocks: true, addOns: true } } },
      });
    },

    /** Booking-holder view source: the booking with the guest's NAME only and the event's public fields. */
    async getBookingForHolder(bookingId: string) {
      return db.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true, eventId: true, roomBlockId: true, totalAmount: true, status: true, checkedIn: true, checkedInAt: true, createdAt: true,
          guest: { select: { name: true } },
          event: { select: { ...EVENT_SUMMARY, description: true, primaryColor: true, secondaryColor: true, accentColor: true, heroImageUrl: true, roomBlocks: true, addOns: true } },
        },
      });
    },

    /** Event id of a booking the user may administer (owner role), or null. */
    async bookingEventForAdmin(authUserId: string, bookingId: string) {
      const b = await db.booking.findFirst({ where: { id: bookingId, event: { members: membership(authUserId, ['owner']) } }, select: { eventId: true } });
      return b?.eventId ?? null;
    },

    /** Role on a booking's event (for 403 vs 404 decisions), or null. */
    async roleOnBooking(authUserId: string, bookingId: string) {
      const b = await db.booking.findFirst({ where: { id: bookingId, event: { members: membership(authUserId, READ_ROLES) } }, select: { eventId: true } });
      return b ? roleOn(authUserId, b.eventId) : null;
    },

    /** Public share-link view source: public fields only, selected explicitly. */
    async getPublicEvent(slug: string) {
      return db.event.findUnique({
        where: { slug },
        select: { name: true, slug: true, type: true, venue: true, location: true, checkIn: true, checkOut: true, description: true, primaryColor: true, secondaryColor: true, accentColor: true, heroImageUrl: true, status: true, roomBlocks: { select: { id: true, roomType: true, description: true, rate: true, totalQty: true, bookedQty: true, hotelName: true } }, addOns: { select: { id: true, name: true, description: true, price: true, isIncluded: true } } },
      });
    },
  };
}

export type OwnerRepo = ReturnType<typeof ownerRepo>;
