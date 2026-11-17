/**
 * Request guards for cookie-authenticated state-changing routes (plan section 6.3): a same-origin check (CSRF) and a
 * pseudonymous audit log. Pure helpers; no I/O except the console log line.
 */
import { createHash } from 'node:crypto';

/**
 * Accepts a state-changing request only when the browser says it comes from this site: `Sec-Fetch-Site` is
 * same-origin, or the `Origin` header matches the request's own origin (or an origin listed in APP_ORIGINS,
 * comma-separated). Requests that carry neither header are refused: the v2 write API is only called by this app's
 * pages, and modern browsers always send at least one of them on fetch() writes.
 */
/** This request's own origin as the browser sees it (behind the platform proxy). */
export function requestOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    return `${proto}://${host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function sameOriginCheck(request: Request, allowed = process.env.APP_ORIGINS ?? ''): { ok: true } | { ok: false; reason: string } {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return { ok: false, reason: 'Cross-site request refused.' };
  const origin = request.headers.get('origin');
  if (!origin) return site === 'same-origin' ? { ok: true } : { ok: false, reason: 'Missing Origin header.' };
  const own = requestOrigin(request);
  if (!own) return { ok: false, reason: 'Bad request URL.' };
  const extra = allowed.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return origin.toLowerCase() === own || extra.includes(origin.toLowerCase()) ? { ok: true } : { ok: false, reason: 'Cross-site request refused.' };
}

/** Stable pseudonym for logs: never the raw user id, booking id, email or token. */
export const pseudonym = (value: string) => createHash('sha256').update(`tbo-audit:${value}`).digest('base64url').slice(0, 12);

export type AuditEvent = {
  action: string;
  result: 'allowed' | 'denied' | 'error';
  status: number;
  actor?: string | null;
  eventId?: string | null;
  resource?: string | null;
  requestId?: string | null;
};

/** One JSON line per security-relevant action. Ids of events are not personal data; actors and bookings are pseudonymised. */
export function audit(e: AuditEvent, sink: (line: string) => void = line => console.info(line)) {
  sink(JSON.stringify({
    type: 'security', at: new Date().toISOString(), action: e.action, result: e.result, status: e.status,
    actor: e.actor ? pseudonym(e.actor) : null, eventId: e.eventId ?? null, resource: e.resource ? pseudonym(e.resource) : null, requestId: e.requestId ?? null,
  }));
}
