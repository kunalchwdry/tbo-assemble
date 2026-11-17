/**
 * Input validation for the owner-scoped (v2) write API. Every write goes through an explicit field allowlist:
 * unknown fields are rejected (not ignored), so identity, ownership and linkage fields (id, eventId of an existing
 * record, agentId, slug, status outside the status endpoint) can never be set through a patch.
 */

export type Valid<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Valid<T> => ({ ok: true, value });
const bad = <T = never>(error: string): Valid<T> => ({ ok: false, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type FieldRule = (value: unknown, name: string) => Valid<unknown>;

const text = (min: number, max: number, nullable = false): FieldRule => (value, name) => {
  if (value === null && nullable) return ok(null);
  if (typeof value !== 'string') return bad(`${name} must be text.`);
  const v = value.trim();
  if (v.length < min) return bad(min === 1 ? `${name} is required.` : `${name} must have at least ${min} characters.`);
  if (v.length > max) return bad(`${name} must have at most ${max} characters.`);
  // Control characters other than tab/newline are never legitimate in these fields.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v)) return bad(`${name} contains control characters.`);
  return ok(nullable && v === '' ? null : v);
};
const color: FieldRule = (value, name) => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? ok(value.toLowerCase()) : bad(`${name} must be a colour like #1e40af.`));
const httpsUrl: FieldRule = (value, name) => {
  if (value === null || value === '') return ok(null);
  if (typeof value !== 'string' || value.length > 2000) return bad(`${name} must be an https URL.`);
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? ok(u.toString()) : bad(`${name} must be an https URL.`);
  } catch {
    return bad(`${name} must be an https URL.`);
  }
};
const date: FieldRule = (value, name) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(value)) return bad(`${name} must be a date (YYYY-MM-DD or an ISO timestamp with time zone).`);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100 ? bad(`${name} is not a valid date.`) : ok(d);
};
const int = (min: number, max: number, nullable = false): FieldRule => (value, name) => {
  if (value === null && nullable) return ok(null);
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? ok(value) : bad(`${name} must be a whole number from ${min} to ${max}.`);
};
const oneOf = (values: readonly string[]): FieldRule => (value, name) => (typeof value === 'string' && values.includes(value) ? ok(value) : bad(`${name} must be one of: ${values.join(', ')}.`));
const email: FieldRule = (value, name) => {
  if (value === null || value === '') return ok(null);
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(value.trim())) return bad(`${name} must be an email address.`);
  return ok(value.trim().toLowerCase());
};
const phone: FieldRule = (value, name) => {
  if (value === null || value === '') return ok(null);
  return typeof value === 'string' && value.length <= 40 && /^[0-9+()\-. ]{3,40}$/.test(value.trim()) ? ok(value.trim()) : bad(`${name} must be a phone number.`);
};

function validateObject(input: unknown, rules: Record<string, FieldRule>, required: string[] = [], allowEmpty = false): Valid<Record<string, unknown>> {
  if (!isRecord(input)) return bad('The request body must be a JSON object.');
  const unknown = Object.keys(input).filter(k => !(k in rules));
  if (unknown.length) return bad(`Unknown or read-only fields: ${unknown.slice(0, 10).join(', ')}.`);
  for (const k of required) if (input[k] === undefined) return bad(`${k} is required.`);
  const out: Record<string, unknown> = {};
  for (const [k, rule] of Object.entries(rules)) {
    if (input[k] === undefined) continue;
    const r = rule(input[k], k);
    if (!r.ok) return r;
    out[k] = r.value;
  }
  if (!allowEmpty && Object.keys(out).length === 0) return bad('Nothing to change.');
  return ok(out);
}

/** Event fields an owner or editor may change. Not here on purpose: id, slug (share links), agentId, status. */
const EVENT_RULES: Record<string, FieldRule> = {
  name: text(1, 200), type: text(1, 60), venue: text(1, 200), location: text(1, 200), description: text(0, 5000, true),
  checkIn: date, checkOut: date, expectedPax: int(0, 100000, true),
  primaryColor: color, secondaryColor: color, accentColor: color, heroImageUrl: httpsUrl,
};

export type EventPatch = Partial<{ name: string; type: string; venue: string; location: string; description: string | null; checkIn: Date; checkOut: Date; expectedPax: number | null; primaryColor: string; secondaryColor: string; accentColor: string; heroImageUrl: string | null }>;

export function validateEventPatch(input: unknown): Valid<EventPatch> {
  const r = validateObject(input, EVENT_RULES);
  if (!r.ok) return r;
  const v = r.value as EventPatch;
  if (v.checkIn && v.checkOut && v.checkOut < v.checkIn) return bad('checkOut must not be before checkIn.');
  return ok(v);
}

/** Mirrors VALID_TRANSITIONS in the legacy src/app/api/events/[eventId]/status/route.ts (kept identical on purpose). */
export const EVENT_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ['active', 'published'],
  active: ['completed', 'cancelled', 'published'],
  completed: ['active'],
  cancelled: ['draft'],
  published: ['active', 'cancelled'],
};
export const EVENT_STATUSES = Object.keys(EVENT_STATUS_TRANSITIONS);

export function validateStatusChange(input: unknown): Valid<{ status: string }> {
  return validateObject(input, { status: oneOf(EVENT_STATUSES) }, ['status']) as Valid<{ status: string }>;
}
export const canTransition = (from: string, to: string) => (EVENT_STATUS_TRANSITIONS[from] ?? []).includes(to);

export const GUEST_STATUSES = ['invited', 'pending', 'confirmed', 'declined', 'cancelled', 'waitlisted', 'checked_in'] as const;
const GUEST_RULES: Record<string, FieldRule> = {
  name: text(1, 200), email, phone, group: text(0, 100, true), status: oneOf(GUEST_STATUSES), proximityRequest: text(0, 200, true),
  notes: text(0, 2000, true), allocatedFloor: text(0, 50, true), allocatedWing: text(0, 50, true), allocatedRoom: text(0, 50, true),
};
export type GuestFields = Partial<{ name: string; email: string | null; phone: string | null; group: string | null; status: string; proximityRequest: string | null; notes: string | null; allocatedFloor: string | null; allocatedWing: string | null; allocatedRoom: string | null }>;

export function validateGuestCreate(input: unknown): Valid<{ eventId: string; guest: GuestFields & { name: string } }> {
  if (!isRecord(input)) return bad('The request body must be a JSON object.');
  const { eventId, ...rest } = input;
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) return bad('eventId must be an event id.');
  const r = validateObject(rest, GUEST_RULES, ['name']);
  return r.ok ? ok({ eventId, guest: r.value as GuestFields & { name: string } }) : r;
}

export function validateGuestPatch(input: unknown): Valid<{ eventId?: string; patch: GuestFields }> {
  if (!isRecord(input)) return bad('The request body must be a JSON object.');
  const { eventId, ...rest } = input;
  if (eventId !== undefined && (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId))) return bad('eventId must be an event id.');
  const r = validateObject(rest, GUEST_RULES);
  return r.ok ? ok({ eventId: eventId as string | undefined, patch: r.value as GuestFields }) : r;
}

export function validateAccessGrant(input: unknown): Valid<{ scope: 'view' | 'upgrade'; expiresInDays: number }> {
  const r = validateObject(input ?? {}, { scope: oneOf(['view', 'upgrade']), expiresInDays: int(1, 365) }, [], true);
  if (!r.ok) return r;
  return ok({ scope: (r.value.scope as 'view' | 'upgrade') ?? 'view', expiresInDays: (r.value.expiresInDays as number) ?? 90 });
}

/** Reads a JSON body with a byte cap that is enforced while streaming, before the body is buffered in full. */
export async function readJsonBody(request: Request, maxBytes = 64 * 1024): Promise<Valid<unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) return bad('Send JSON (Content-Type: application/json).');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return bad('The request body is too large.');
  if (!request.body) return bad('The request body must be a JSON object.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); return bad('The request body is too large.'); }
    chunks.push(value);
  }
  try {
    return ok(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  } catch {
    return bad('The request body is not valid JSON.');
  }
}
