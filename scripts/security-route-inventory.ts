/**
 * Route inventory for the security plan (Phase 0). Statically scans every API route, every server page that queries
 * the database directly and every server action, and records: methods, identity checks, Prisma models read and
 * written, related data loaded, rate limiting, outbound requests and the in-app pages that call each route.
 *
 *   npx tsx scripts/security-route-inventory.ts            # writes docs/security/route-inventory.{json,md}
 *   npx tsx scripts/security-route-inventory.ts --check    # exit 1 if a route exists that has no classification
 *
 * Static analysis only: it reads source text, never calls a server or database. Classifications (who is meant to
 * call a route and whether it must stay public) are written by hand in CLASSIFY below and reviewed with the code.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

type Category = 'owner-data (legacy, no auth)' | 'public booking flow' | 'public data / demo' | 'cron' | 'disabled' | 'owner-scoped v2' | 'public v2' | 'account';
type Classification = { category: Category; intended: string; mustStayPublic: boolean; note?: string };

/** Hand-written intent per route (path relative to src/app/api, dynamic segments as written on disk). */
const CLASSIFY: Record<string, Classification> = {
  'events': { category: 'owner-data (legacy, no auth)', intended: 'owner (dashboard)', mustStayPublic: false, note: 'GET lists every event with guests, bookings and rules; POST creates events (and a demo agent when none exists).' },
  'events/[eventId]': { category: 'owner-data (legacy, no auth)', intended: 'owner; booking page reads it today', mustStayPublic: false, note: 'GET full event; PATCH/DELETE without identity.' },
  'events/[eventId]/activity': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/allocate': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/auto-allocate': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/bulk-checkin': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/clone': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/discount': { category: 'owner-data (legacy, no auth)', intended: 'owner (writes); public price display (reads)', mustStayPublic: false },
  'events/[eventId]/feedback': { category: 'public booking flow', intended: 'guest submits; owner reads', mustStayPublic: true, note: 'Submission can stay public with limits; the read side is owner-only.' },
  'events/[eventId]/nudge': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/pax': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/qr-batch': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/quote': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/[eventId]/rooming-list': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false, note: 'Export of guest names and rooms.' },
  'events/[eventId]/status': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'events/search': { category: 'owner-data (legacy, no auth)', intended: 'owner; booking page uses it today', mustStayPublic: false, note: 'Returns event ids by name, which the booking page then expands via /api/events/{id}.' },
  'guests': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false, note: 'GET returns every guest record (names, emails, phones).' },
  'guests/import': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'guests/search': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false },
  'bookings': { category: 'public booking flow', intended: 'guest creates a booking (POST); owner lists (GET)', mustStayPublic: true, note: 'Creation stays public for open events; listing must become owner-only.' },
  'bookings/[bookingId]': { category: 'public booking flow', intended: 'booking holder (confirmation link); owner', mustStayPublic: true, note: 'Booking id acts as the capability today.' },
  'bookings/[bookingId]/checkin': { category: 'public booking flow', intended: 'event staff / owner; guest self check-in', mustStayPublic: false },
  'bookings/[bookingId]/upgrade': { category: 'public booking flow', intended: 'booking holder', mustStayPublic: true },
  'room-occupants': { category: 'owner-data (legacy, no auth)', intended: 'owner; booking holder adds roommates', mustStayPublic: false },
  'schedule': { category: 'owner-data (legacy, no auth)', intended: 'owner (writes); public itinerary (reads)', mustStayPublic: false },
  'vendors': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false, note: 'Supplier details.' },
  'rfp': { category: 'owner-data (legacy, no auth)', intended: 'owner', mustStayPublic: false, note: 'Supplier requests and quotes.' },
  'waitlist': { category: 'public booking flow', intended: 'guest joins (POST); owner reads', mustStayPublic: true },
  'seed': { category: 'disabled', intended: 'nobody on deployed environments', mustStayPublic: false },
  'ai/parse': { category: 'public data / demo', intended: 'anonymous upload parsing (demo)', mustStayPublic: true, note: 'Needs decompression caps for XLSX/DOCX (plan section 6).' },
  'procurement/plan': { category: 'public data / demo', intended: 'anonymous planner (demo, synthetic or user inputs)', mustStayPublic: true },
  'geocode': { category: 'public data / demo', intended: 'anonymous venue lookup', mustStayPublic: true },
  'cron/collect-fares': { category: 'cron', intended: 'Vercel cron with secret', mustStayPublic: false },
  'cron/collect-traffic': { category: 'cron', intended: 'Vercel cron with secret', mustStayPublic: false },
  'v2/events': { category: 'owner-scoped v2', intended: 'signed-in owner', mustStayPublic: false },
  'v2/events/[eventId]': { category: 'owner-scoped v2', intended: 'signed-in owner', mustStayPublic: false },
  'v2/guests': { category: 'owner-scoped v2', intended: 'signed-in owner', mustStayPublic: false },
  'v2/bookings/[bookingId]': { category: 'owner-scoped v2', intended: 'event member (full) or booking-holder session (narrow view)', mustStayPublic: false },
  'v2/events/[eventId]/status': { category: 'owner-scoped v2', intended: 'event owner or editor', mustStayPublic: false },
  'v2/guests/[guestId]': { category: 'owner-scoped v2', intended: 'event owner or editor', mustStayPublic: false },
  'v2/bookings/[bookingId]/access': { category: 'owner-scoped v2', intended: 'event owner (issue / revoke booking links)', mustStayPublic: false },
  'v2/booking-access/exchange': { category: 'public v2', intended: 'holder of a booking-link token', mustStayPublic: true, note: 'Exchanges a 256-bit link token for an HttpOnly session bound to one booking; same-origin, rate-limited.' },
  'v2/booking-access/legacy': { category: 'public v2', intended: 'holder of a pre-existing booking URL (temporary bridge)', mustStayPublic: true, note: 'Bearer booking id -> 2-hour view-only session; LEGACY_BOOKING_LINKS=0 disables it (410). Sunset planned.' },
  'v2/public/events/[slug]': { category: 'public v2', intended: 'anyone with the event link', mustStayPublic: true, note: 'Allowlisted public fields of active/published events only; no guests, agent, rules or ids.' },
};
/** v2 route files delegate to src/lib/access handlers; record what each handler really enforces and touches. */
const V2_POLICY = 'v2 owner policy (getUser + EventMember)';
const V2_HANDLERS: Record<string, { protectedBy: string; reads: string[]; writes: string[] }> = {
  listEventsHandler: { protectedBy: V2_POLICY, reads: ['event', 'eventMember'], writes: [] },
  getEventHandler: { protectedBy: V2_POLICY, reads: ['addOn', 'attritionRule', 'booking', 'event', 'eventMember', 'guest', 'roomBlock'], writes: [] },
  patchEventHandler: { protectedBy: V2_POLICY, reads: ['eventMember'], writes: ['event'] },
  eventStatusHandler: { protectedBy: V2_POLICY, reads: ['event', 'eventMember'], writes: ['event'] },
  listGuestsHandler: { protectedBy: V2_POLICY, reads: ['eventMember', 'guest'], writes: [] },
  createGuestHandler: { protectedBy: V2_POLICY, reads: ['eventMember'], writes: ['guest'] },
  patchGuestHandler: { protectedBy: V2_POLICY, reads: ['eventMember', 'guest'], writes: ['guest'] },
  deleteGuestHandler: { protectedBy: V2_POLICY, reads: ['booking', 'eventMember', 'guest'], writes: ['guest'] },
  getBookingHandler: { protectedBy: `${V2_POLICY} or booking capability session`, reads: ['booking', 'bookingAccess', 'eventMember'], writes: [] },
  issueBookingAccessHandler: { protectedBy: `${V2_POLICY}, owner role`, reads: ['booking', 'eventMember'], writes: ['bookingAccess'] },
  revokeBookingAccessHandler: { protectedBy: `${V2_POLICY}, owner role`, reads: ['booking', 'eventMember'], writes: ['bookingAccess'] },
  exchangeLinkHandler: { protectedBy: 'booking capability (256-bit link token)', reads: ['bookingAccess'], writes: ['bookingAccess'] },
  legacyBookingLinkHandler: { protectedBy: 'legacy booking id as bearer (view-only bridge)', reads: ['booking'], writes: ['bookingAccess'] },
  publicEventHandler: { protectedBy: 'none', reads: ['addOn', 'event', 'roomBlock'], writes: [] },
};
const PUBLIC_DATA_PREFIXES = ['flight/', 'india-market/', 'market/'];
function classify(route: string): Classification | null {
  if (CLASSIFY[route]) return CLASSIFY[route];
  if (PUBLIC_DATA_PREFIXES.some(p => route.startsWith(p))) return { category: 'public data / demo', intended: 'anonymous research and demo data', mustStayPublic: true };
  if (route.startsWith('v2/public/')) return { category: 'public v2', intended: 'anyone with the share link (public fields only)', mustStayPublic: true };
  if (route.startsWith('v2/')) return { category: 'owner-scoped v2', intended: 'signed-in owner or capability session', mustStayPublic: false };
  return null;
}

/** Remove every `{ … }` block that starts at a match of `opener` (brace-balanced), e.g. Prisma `_count` selections. */
function stripBlocks(text: string, opener: RegExp): string {
  let out = '', i = 0;
  for (const m of text.matchAll(opener)) {
    if (m.index! < i) continue;
    out += text.slice(i, m.index);
    let depth = 0, j = m.index! + m[0].length - 1;
    for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) break; }
    i = j + 1;
  }
  return out + text.slice(i);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const MUTATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const allSource = walk(SRC).filter(f => /\.(ts|tsx)$/.test(f));

function analyse(file: string) {
  const text = readFileSync(file, 'utf8');
  const methods = [...text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1]);
  const prismaCalls = [...text.matchAll(/\b(?:prisma|tx|db)\.(\w+)\.(\w+)\s*\(/g)].map(m => ({ model: m[1], op: m[2] }));
  const reads = [...new Set(prismaCalls.filter(c => !MUTATIONS.has(c.op)).map(c => c.model))].sort();
  const writes = [...new Set(prismaCalls.filter(c => MUTATIONS.has(c.op)).map(c => c.model))].sort();
  const rawSql = /\$(?:queryRaw|executeRaw)/.test(text);
  // Relation loads (`guests: true`, `agent: { select: … }`), ignoring `_count: { … }` blocks, which load numbers only.
  const loadText = stripBlocks(text, /_count\s*:\s*\{/g);
  const loads = [...new Set([...loadText.matchAll(/\b(guests|bookings|agent|attritionRules|discountRules|activityLogs|rfps|occupants)\s*:\s*(true|\{\s*select\s*:\s*\{[^{}]*\}|\{)/g)]
    .map(m => (m[2].startsWith('{') && /select/.test(m[2]) ? `${m[1]}(${[...m[2].matchAll(/(\w+)\s*:\s*true/g)].map(x => x[1]).join(',')})` : m[1])))].sort();
  const identity = [
    /auth\.getUser\(|getUser\(\)/.test(text) && 'supabase getUser',
    /ownerScope(Deps|Enabled)|requireVerifiedUser|principal\(/.test(text) && 'v2 owner policy',
    /CRON_SECRET|timingSafeEqual/.test(text) && 'cron secret',
    /bookingSession|booking-access|BOOKING_SESSION/.test(text) && 'booking capability',
  ].filter(Boolean) as string[];
  // A handler whose whole body is a fixed refusal (e.g. the seed route), with no database access at all.
  const disabledMarker = methods.length > 0 && prismaCalls.length === 0 && !rawSql && /is disabled|are disabled/i.test(text) && /status:\s*(403|404|410)\b/.test(text);
  const rateLimited = /routeLimiters|rateLimit\(|limiter\.|createRateLimiter/.test(text);
  const outbound = /\bfetch\(/.test(text);
  const body = /request\.(json|formData|text|arrayBuffer)\(|req\.(json|formData)\(/.test(text);
  return { methods, reads, writes, rawSql, loads, identity, disabledMarker, rateLimited, outbound, body };
}

function consumersOf(route: string): string[] {
  const parts = route.split('/').map(seg => (seg.startsWith('[') ? '(?:\\$\\{[^}]+\\}|[A-Za-z0-9_-]+)' : seg.replace(/[-]/g, '\\-')));
  const re = new RegExp(`/api/${parts.join('/')}(?![A-Za-z0-9_-]|/[A-Za-z])`);
  return allSource
    .filter(f => !f.includes(join('src', 'app', 'api')) && !f.includes(join('src', 'lib', 'access')) && !f.includes(join('src', 'generated')))
    .filter(f => re.test(readFileSync(f, 'utf8')))
    .map(f => relative(ROOT, f))
    .sort();
}

const apiDir = join(SRC, 'app', 'api');
const routes = walk(apiDir)
  .filter(f => f.endsWith('route.ts'))
  .map(f => relative(apiDir, f).replace(/\/route\.ts$/, ''))
  .sort();

const rows = routes.map(route => {
  const a = analyse(join(apiDir, route, 'route.ts'));
  const c = classify(route);
  const handlers = [...readFileSync(join(apiDir, route, 'route.ts'), 'utf8').matchAll(/(\w+Handler)\(ownerScopeDeps\)/g)].map(m => m[1]);
  if (handlers.length) {
    const known = handlers.map(h => { if (!V2_HANDLERS[h]) throw new Error(`Unknown v2 handler ${h} in ${route}: add it to V2_HANDLERS`); return V2_HANDLERS[h]; });
    const protections = [...new Set(known.map(k => k.protectedBy))];
    return {
      route: `/api/${route}`, ...a,
      reads: [...new Set(known.flatMap(k => k.reads))].sort(), writes: [...new Set(known.flatMap(k => k.writes))].sort(),
      identity: protections.filter(x => x !== 'none'), protectedBy: protections.join('; '),
      flag: 'OWNER_SCOPE_API=1 (503 when off)', handlers, classification: c, consumers: consumersOf(route),
    };
  }
  const protectedBy = a.identity.length ? a.identity.join(', ') : a.disabledMarker ? 'disabled' : 'none';
  return { route: `/api/${route}`, ...a, protectedBy, classification: c, consumers: consumersOf(route) };
});

/** Server pages that query the database directly, and server actions. */
const pages = allSource
  .filter(f => /\/(page|layout)\.tsx$/.test(f) && /from ['"]@\/lib\/db['"]/.test(readFileSync(f, 'utf8')))
  .map(f => {
    const a = analyse(f);
    const rel = relative(join(SRC, 'app'), f).replace(/\/(page|layout)\.tsx$/, '') || '/';
    return { page: `/${rel}`, file: relative(ROOT, f), reads: a.reads, writes: a.writes, loads: a.loads, protectedBy: a.identity.length ? a.identity.join(', ') : 'none' };
  })
  .sort((x, y) => x.page.localeCompare(y.page));
const actions = allSource
  .filter(f => /^['"]use server['"]/m.test(readFileSync(f, 'utf8')))
  .map(f => { const a = analyse(f); return { file: relative(ROOT, f), reads: a.reads, writes: a.writes, protectedBy: a.identity.length ? a.identity.join(', ') : 'none' }; });

const unclassified = rows.filter(r => !r.classification).map(r => r.route);
if (process.argv.includes('--check')) {
  if (unclassified.length) { console.error(`Unclassified routes: ${unclassified.join(', ')}`); process.exit(1); }
  console.log(`OK: ${rows.length} routes classified.`);
  process.exit(0);
}

const exposed = rows.filter(r => r.protectedBy === 'none' && r.classification && !r.classification.mustStayPublic && r.classification.category !== 'disabled');
const summary = {
  generatedFrom: 'static scan of src/ (no requests made)',
  routes: rows.length,
  byCategory: Object.fromEntries([...new Set(rows.map(r => r.classification?.category ?? 'UNCLASSIFIED'))].sort().map(k => [k, rows.filter(r => (r.classification?.category ?? 'UNCLASSIFIED') === k).length])),
  withoutIdentityCheck: rows.filter(r => r.protectedBy === 'none').length,
  ownerDataWithoutIdentityCheck: exposed.length,
  writingRoutesWithoutIdentityCheck: rows.filter(r => r.protectedBy === 'none' && r.writes.length).length,
  serverPagesWithDirectDbAccess: pages.length,
  serverPagesWithoutIdentityCheck: pages.filter(p => p.protectedBy === 'none').length,
  unclassified,
};
writeFileSync(join(ROOT, 'docs/security/route-inventory.json'), JSON.stringify({ summary, routes: rows, pages, actions }, null, 2) + '\n');

const yes = (b: boolean) => (b ? 'yes' : '');
const list = (xs: string[]) => (xs.length ? xs.join(', ') : '');
const md: string[] = [
  '# Route inventory and access matrix',
  '',
  'Generated by `npx tsx scripts/security-route-inventory.ts` from a static scan of `src/` (no requests made). Regenerate it after',
  'changing routes; `--check` fails when a route has no hand-written classification. "Identity check" means the code calls a',
  'verified identity source (Supabase `getUser`, the v2 owner policy, a cron secret or a booking capability). It does not prove',
  'the check is correct; the v2 checks are covered by `tests/owner-scope*.test.ts`.',
  '',
  '## Summary',
  '',
  `| Measure | Count |`,
  `|---|---|`,
  `| API routes | ${summary.routes} |`,
  ...Object.entries(summary.byCategory).map(([k, v]) => `| – ${k} | ${v} |`),
  `| Routes with no identity check | ${summary.withoutIdentityCheck} |`,
  `| Routes that should not be public but have no identity check | **${summary.ownerDataWithoutIdentityCheck}** |`,
  `| Routes that write data with no identity check | **${summary.writingRoutesWithoutIdentityCheck}** |`,
  `| Server pages that query the database directly | ${summary.serverPagesWithDirectDbAccess} (${summary.serverPagesWithoutIdentityCheck} with no identity check) |`,
  '',
  '## API routes',
  '',
  '| Route | Methods | Category | Identity check | Writes | Loads | Rate limit | Must stay public | In-app callers |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| \`${r.route}\` | ${r.methods.join(', ')} | ${r.classification?.category ?? '**UNCLASSIFIED**'} | ${r.protectedBy} | ${list(r.writes)}${r.rawSql ? ' (raw SQL)' : ''} | ${list(r.loads)} | ${yes(r.rateLimited)} | ${r.classification ? yes(r.classification.mustStayPublic) : '?'} | ${r.consumers.length} |`),
  '',
  '## Notes on intended callers',
  '',
  ...rows.filter(r => r.classification?.note).map(r => `- \`${r.route}\` (${r.classification!.intended}): ${r.classification!.note}`),
  '',
  '## Server pages with direct database access',
  '',
  'Server components render on the server; data reaches the browser only through what the page renders or passes to client',
  'components. These pages still need authorization when they show owner data.',
  '',
  '| Page | Reads | Loads | Identity check |',
  '|---|---|---|---|',
  ...pages.map(p => `| \`${p.page}\` | ${list(p.reads)} | ${list(p.loads)} | ${p.protectedBy} |`),
  '',
  '## Server actions',
  '',
  '| File | Reads | Writes | Identity check |',
  '|---|---|---|---|',
  ...actions.map(a => `| \`${a.file}\` | ${list(a.reads)} | ${list(a.writes)} | ${a.protectedBy} |`),
  '',
];
writeFileSync(join(ROOT, 'docs/security/route-inventory.md'), md.join('\n'));
console.log(JSON.stringify(summary, null, 2));
