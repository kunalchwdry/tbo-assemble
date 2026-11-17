/**
 * Booking capabilities (plan Phase 3). A capability is 32 random bytes (256 bits), shown once and stored only as its
 * SHA-256 hash. Two kinds:
 *
 *   * link    - issued and revocable by the event's owner; meant to travel in the URL FRAGMENT
 *               (/booking/access#<token>), which browsers never send to servers or in Referer headers;
 *   * session - what a link (or, during the transition, a legacy /booking/<id> URL) is exchanged for. It lives in an
 *               HttpOnly, SameSite=Lax cookie scoped to /api/v2, expires within 12 hours and is bound to ONE booking.
 *
 * Revoking a booking's access revokes its links and its sessions at once. Raw tokens never appear in logs.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';

export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
export const SESSION_COOKIE = 'tbo_booking_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LEGACY_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export type Scope = 'view' | 'upgrade';
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('base64url');

export function capabilityStore(db: PrismaClient) {
  async function createSession(bookingId: string, scope: Scope, expiresAt: Date, source: 'issued' | 'legacy-booking-url', now: Date) {
    const token = newToken();
    await db.bookingAccess.create({ data: { bookingId, kind: 'session', scope, tokenHash: hashToken(token), source, createdAt: now, expiresAt } });
    return { token, expiresAt };
  }

  return {
    /** Issues a link capability. Returns the raw token ONCE; only its hash is stored. */
    async issueLink(bookingId: string, scope: Scope, expiresAt: Date, now: Date) {
      const token = newToken();
      await db.bookingAccess.create({ data: { bookingId, kind: 'link', scope, tokenHash: hashToken(token), source: 'issued', createdAt: now, expiresAt } });
      return { token, expiresAt };
    },

    /** Revokes every link and session of a booking; returns how many were active. */
    async revokeAll(bookingId: string, now: Date) {
      const r = await db.bookingAccess.updateMany({ where: { bookingId, revokedAt: null }, data: { revokedAt: now } });
      return r.count;
    },

    /** Exchanges a valid link for a session (same scope, never outliving the link). Null for anything invalid. */
    async exchangeLink(token: string, now: Date) {
      if (!TOKEN_FORMAT.test(token)) return null;
      const link = await db.bookingAccess.findFirst({ where: { tokenHash: hashToken(token), kind: 'link', revokedAt: null, expiresAt: { gt: now } }, select: { id: true, bookingId: true, scope: true, expiresAt: true } });
      if (!link) return null;
      await db.bookingAccess.update({ where: { id: link.id }, data: { lastUsedAt: now } });
      const expiresAt = new Date(Math.min(link.expiresAt.getTime(), now.getTime() + SESSION_TTL_MS));
      const session = await createSession(link.bookingId, link.scope as Scope, expiresAt, 'issued', now);
      return { bookingId: link.bookingId, scope: link.scope as Scope, ...session };
    },

    /**
     * Compatibility bridge for confirmation URLs sent before capabilities existed (/booking/<bookingId>): the booking id
     * itself is accepted ONCE MORE as a legacy capability and exchanged for a short, view-only session. Monitored and
     * switchable off (LEGACY_BOOKING_LINKS=0). It carries the risk of any booking id that has already leaked.
     */
    async legacySession(bookingId: string, now: Date) {
      const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
      if (!booking) return null;
      const session = await createSession(booking.id, 'view', new Date(now.getTime() + LEGACY_SESSION_TTL_MS), 'legacy-booking-url', now);
      return { bookingId: booking.id, scope: 'view' as Scope, ...session };
    },

    /** The booking a session cookie grants, or null (missing, malformed, unknown, revoked or expired). */
    async resolveSession(token: string | null, now: Date) {
      if (!token || !TOKEN_FORMAT.test(token)) return null;
      const s = await db.bookingAccess.findFirst({ where: { tokenHash: hashToken(token), kind: 'session', revokedAt: null, expiresAt: { gt: now } }, select: { bookingId: true, scope: true } });
      return s ? { bookingId: s.bookingId, scope: s.scope as Scope } : null;
    },
  };
}

export type CapabilityStore = ReturnType<typeof capabilityStore>;

/** Set-Cookie value for a booking session. `secure` is false only for plain-http local development. */
export function sessionCookie(token: string, expiresAt: Date, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/api/v2; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? '; Secure' : ''}`;
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return TOKEN_FORMAT.test(value) ? value : null;
    }
  }
  return null;
}
