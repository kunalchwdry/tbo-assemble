import 'server-only';
import prisma from '@/lib/db';
import { supabaseServer } from '@/lib/supabase/server';
import { ownerScopeEnabled, type OwnerScopeDeps } from './owner-scope-handlers';
import type { EventLike } from './event-access';

/**
 * Real dependencies of the owner-scoped API. Identity comes from Supabase `getUser()` (verified server-side); data
 * comes from Prisma, which connects with elevated credentials and bypasses RLS, so every query here is scoped in code.
 *
 * REQUIRES the approved ownership migration (Agent."authUserId", docs/security/ownership-migration.sql). Until it is
 * applied the column does not exist, which is why the routes only load this module when OWNER_SCOPE_API=1.
 * The column is read with parameterised raw SQL so the Prisma schema (and every existing query) stays unchanged.
 */
const ownerOf = async (agentId: string) =>
  (await prisma.$queryRaw<{ authUserId: string | null }[]>`SELECT "authUserId"::text AS "authUserId" FROM "Agent" WHERE id = ${agentId}`)[0]?.authUserId ?? null;

const withoutAgent = <T extends { agentId?: unknown }>(event: T) => { const copy: Record<string, unknown> = { ...event }; delete copy.agentId; delete copy.agent; return copy as unknown as EventLike; };

export const ownerScopeDeps: OwnerScopeDeps = {
  enabled: ownerScopeEnabled,
  async principal() {
    const client = await supabaseServer();
    const { data, error } = await client.auth.getUser();
    return error || !data.user ? { kind: 'anonymous' } : { kind: 'user', authUserId: data.user.id };
  },
  async listOwnedEvents(authUserId) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT e.id FROM "Event" e JOIN "Agent" a ON a.id = e."agentId" WHERE a."authUserId" = ${authUserId}::uuid`;
    if (!ids.length) return [];
    const events = await prisma.event.findMany({
      where: { id: { in: ids.map(r => r.id) } }, orderBy: { checkIn: 'asc' },
      select: { id: true, name: true, slug: true, type: true, venue: true, location: true, checkIn: true, checkOut: true, status: true, expectedPax: true },
    });
    return events as unknown as EventLike[];
  },
  async getEvent(eventId, withGuests) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { roomBlocks: true, addOns: true, ...(withGuests ? { guests: true, bookings: true } : {}) } });
    if (!event) return null;
    return { event: withoutAgent(event), ownerAuthUserId: await ownerOf(event.agentId) };
  },
  async listGuests(eventId) {
    return prisma.guest.findMany({ where: { eventId }, orderBy: { name: 'asc' } }) as unknown as Promise<Record<string, unknown>[]>;
  },
  async getBooking(bookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { guest: { select: { name: true, email: true, phone: true } }, addOns: true } });
    if (!booking) return null;
    const event = await prisma.event.findUnique({ where: { id: booking.eventId }, include: { roomBlocks: true, addOns: true } });
    if (!event) return null;
    return { booking: booking as unknown as Record<string, unknown> & { id: string; eventId: string; totalAmount: number; status: string }, event: { event: withoutAgent(event), ownerAuthUserId: await ownerOf(event.agentId) } };
  },
};
