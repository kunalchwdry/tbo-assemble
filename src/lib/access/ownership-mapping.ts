/**
 * Approved ownership mapping (plan Phase 1.3). Turns an explicit, reviewed list of (eventId -> Supabase user id, role)
 * grants into EventMember rows. Never infers ownership (no email matching). Dry run by default; applying needs the
 * mapping's fingerprint from the dry run, an approval reference, and runs in ONE transaction (all or nothing).
 * Reports contain event ids, counts and user-id prefixes only: no names, emails or phone numbers.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { ROLES, UUID, type Role } from './event-access';

export type Grant = { eventId: string; authUserId: string; role: Role };
export type Mapping = { approval: { approvedBy: string; reference: string; date: string }; grants: Grant[] };
export type GrantCheck = { eventId: string; user: string; role: string; ok: boolean; problems: string[]; eventStatus?: string; guests?: number; bookings?: number; activeMembers?: number };
export type MappingReport = { fingerprint: string; reference: string; grants: GrantCheck[]; ok: boolean; problems: string[]; authUsersChecked: boolean };

const prefix = (id: string) => `${id.slice(0, 8)}…`;
/** Stable fingerprint of the exact mapping (key order normalised); the operator must echo it to apply. */
export function fingerprint(m: Mapping) {
  const canonical = JSON.stringify({ approval: { approvedBy: m.approval?.approvedBy, reference: m.approval?.reference, date: m.approval?.date }, grants: (m.grants ?? []).map(g => ({ eventId: g.eventId, authUserId: g.authUserId, role: g.role })) });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

const noEmail = (s: unknown, max = 200) => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !s.includes('@');

export async function checkMapping(db: PrismaClient, m: Mapping, opts: { allowAdditionalOwner?: boolean } = {}): Promise<MappingReport> {
  const problems: string[] = [];
  if (!m || typeof m !== 'object' || !Array.isArray(m.grants)) return { fingerprint: '', reference: '', grants: [], ok: false, problems: ['The mapping must be {approval, grants[]}.'], authUsersChecked: false };
  if (!noEmail(m.approval?.approvedBy) || !noEmail(m.approval?.reference) || !/^\d{4}-\d{2}-\d{2}$/.test(m.approval?.date ?? '')) problems.push('approval needs approvedBy and reference (no email addresses) and a YYYY-MM-DD date.');
  if (m.grants.length === 0 || m.grants.length > 500) problems.push('grants must list 1 to 500 entries.');

  const authTable = await db.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('auth.users')::text AS t`;
  const authUsersChecked = !!authTable[0]?.t;
  const seen = new Set<string>();
  const grants: GrantCheck[] = [];
  for (const g of m.grants) {
    const p: string[] = [];
    if (!UUID.test(g?.eventId ?? '')) p.push('eventId is not an id');
    if (!UUID.test(g?.authUserId ?? '')) p.push('authUserId is not a Supabase user id');
    if (!(ROLES as readonly string[]).includes(g?.role)) p.push(`role must be one of ${ROLES.join(', ')}`);
    const key = `${g?.eventId}:${g?.authUserId}`;
    if (seen.has(key)) p.push('duplicate grant');
    seen.add(key);
    const check: GrantCheck = { eventId: String(g?.eventId ?? ''), user: UUID.test(g?.authUserId ?? '') ? prefix(g.authUserId) : 'invalid', role: String(g?.role ?? ''), ok: false, problems: p };
    if (UUID.test(g?.eventId ?? '')) {
      const ev = await db.event.findUnique({ where: { id: g.eventId }, select: { status: true, _count: { select: { guests: true, bookings: true } }, members: { where: { revokedAt: null }, select: { authUserId: true, role: true } } } });
      if (!ev) p.push('event not found');
      else {
        Object.assign(check, { eventStatus: ev.status, guests: ev._count.guests, bookings: ev._count.bookings, activeMembers: ev.members.length });
        if (ev.members.some(x => x.authUserId === g.authUserId)) p.push('this user already has a role on this event');
        if (g.role === 'owner' && ev.members.some(x => x.role === 'owner') && !opts.allowAdditionalOwner) p.push('event already has an owner (use --allow-additional-owner only if intended)');
      }
    }
    if (authUsersChecked && UUID.test(g?.authUserId ?? '')) {
      const u = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM auth.users WHERE id = ${g.authUserId}::uuid`;
      if (!u[0]?.n) p.push('no such Supabase user');
    }
    check.ok = p.length === 0;
    grants.push(check);
  }
  if (!authUsersChecked) problems.push('auth.users is not reachable from this connection: user ids were NOT verified (refused unless --skip-auth-check).');
  return { fingerprint: fingerprint(m), reference: String(m.approval?.reference ?? ''), grants, ok: problems.length === 0 && grants.every(g => g.ok), problems, authUsersChecked };
}

export async function applyMapping(db: PrismaClient, m: Mapping, confirm: string, opts: { allowAdditionalOwner?: boolean; skipAuthCheck?: boolean } = {}) {
  const report = await checkMapping(db, m, opts);
  const blocking = report.problems.filter(p => !(opts.skipAuthCheck && p.startsWith('auth.users is not reachable')));
  if (blocking.length || !report.grants.every(g => g.ok)) return { applied: 0, report, refused: 'The mapping has problems; fix them and run the dry run again.' };
  if (confirm !== report.fingerprint) return { applied: 0, report, refused: 'The confirmation does not match this mapping\'s fingerprint (run the dry run and pass --confirm <fingerprint>).' };
  const applied = await db.$transaction(async tx => {
    let n = 0;
    for (const g of m.grants) {
      await tx.eventMember.create({ data: { eventId: g.eventId, authUserId: g.authUserId, role: g.role, grantedBy: m.approval.reference } });
      n++;
    }
    return n;
  });
  return { applied, report };
}
