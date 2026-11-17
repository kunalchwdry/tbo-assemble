# Owner-scoped event, guest and booking access: design, tests and migration plan

> **Superseded (17 Nov 2026).** This plan described agent-level ownership (`Agent.authUserId`). The project owner chose
> **event-level ownership** instead: see [`event-ownership.md`](event-ownership.md) (design, migration, rollout) and
> [`booking-capabilities.md`](booking-capabilities.md). The public-endpoint resource review below still applies.


Status: **designed and tested locally with mocks. Disabled by default. Nothing is applied to any database or
deployment.** Every step below that touches data, accounts or production settings needs explicit approval.

## Exposure today (legacy routes, unchanged on this branch)

Production was probed on 16 Nov 2026; only counts were recorded.
- `GET /api/events` returns all 7 events, including room blocks, guests, bookings, attrition rules and add-ons.
- `GET /api/guests` returns 142 guest records.
- None of the legacy `/api/events*`, `/api/guests*`, `/api/bookings*`, `/api/rfp`, `/api/room-occupants`,
  `/api/schedule`, `/api/vendors`, `/api/waitlist` and `/api/seed` routes checks identity.
- `POST /api/events` creates a demo agent with a hard-coded password when no agent exists.
- The Supabase RLS policies in `docs/security/*.sql` do **not** protect these routes: Prisma connects with elevated
  credentials and bypasses RLS (see `rollout.md`).

## Replacement (on this branch)

| Piece | File | What it does |
|---|---|---|
| Policy | `src/lib/access/event-access.ts` | One pure `decide(action, principal, target)` for every owner-scoped handler, plus a public event view and a booking-holder view |
| Handlers | `src/lib/access/owner-scope-handlers.ts` | v2 read handlers with injected identity and data access. 503 unless `OWNER_SCOPE_API=1` |
| Real wiring | `src/lib/access/owner-scope-deps.ts` | Supabase `getUser()` for identity; Prisma queries scoped in code; reads `Agent."authUserId"` with parameterised SQL, so the Prisma schema is unchanged |
| Routes | `src/app/api/v2/events`, `v2/events/[eventId]`, `v2/guests?eventId=`, `v2/bookings/[bookingId]` | Load the real wiring only when enabled |
| Tests | `tests/owner-scope.test.ts` | 7 tests, local mocks only (below) |

Rules:
- **Ownership:** an event belongs to the Supabase user linked to its agent (`Agent.authUserId`). Events whose agent is
  not linked are **unclaimed**. The v2 API never lists, reveals or changes an unclaimed event.
- **Denials:**
  - 401: an owner-only endpoint is called without a valid session. Auth errors and malformed identities count as no
    session.
  - 404: a signed-in user asks for a missing event or someone else's event. The status and body are identical in both
    cases, so ids cannot be probed.
  - 400: a malformed `eventId` on the guest list.
  - Malformed ids never reach the data layer.
- **Share links:** `/event/{slug}` and `/event/{slug}/book` are server pages that read Prisma directly. They are
  unchanged and keep working. In the policy, a slug grants only the public event view (no guests, bookings, rules,
  agent or logs).
- **Booking links:** in `GET /api/v2/bookings/{id}`, the random v4 UUID booking id is the capability. Its holder sees
  only that booking: guest name (no email or phone), status, amount, and room availability for upgrades. The event
  owner sees the full booking. Links for unclaimed events keep working.
- **Response headers:** every response is `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

Verified (`npx tsx tests/owner-scope.test.ts`, 7/7, no database or network):
- **Policy matrix:** covers anonymous, owner, other user and unclaimed events.
- **Public and holder views:** checked for leaks.
- **Disabled switch:** returns 503 without touching identity or data.
- **Sessions:** a failed session fails closed.
- **No enumeration:** a cross-user request gets the same 404 as a missing event, and guests are never loaded for a
  non-owner.
- **Booking holders:** get the narrow view only.
- **Routes:** the real route files return 503 while the switch is unset.
- **Mutation checks:** five deliberate breaks each fail 1–2 tests:
  - ownership not checked;
  - holder sees contact details;
  - no session check;
  - auth error fails open;
  - switch ignored.

**Not verified:** the real Supabase and Prisma wiring against a database. No accessible Supabase project, and the
`authUserId` column does not exist yet. Before enabling, it must be tested on a preview with synthetic accounts, which
needs approval.

## Migration plan (each numbered step needs approval; default = do nothing)

0. **Done on this branch:** policy, handlers, routes (off) and tests. No production effect even if merged, because the
   routes answer 503.
1. **Additive schema change:** `docs/security/ownership-migration.sql` (draft) adds a nullable, unique
   `Agent."authUserId"` that references `auth.users`.
   - No row changes, so existing queries are unaffected.
   - Rollback: drop the constraint, index and column.
2. **Decide the 7 ownerless events (user's choice).** These events are preserved in every option:
   - **A. Assign:** link one named, verified account to the existing agent. Use a reviewed one-off SQL listing the
     exact agent id, run with the user present. Never match by email.
   - **B. Leave unclaimed (default):** nothing changes. They stay reachable through the legacy routes and share links
     and are invisible in v2.
   - **C. Archive:** export them, then make them read-only (needs a separate design).
3. **Preview test:**
   - Set `OWNER_SCOPE_API=1` on a preview deployment only.
   - Test owner, cross-user, anonymous, expired-session and booking-holder cases with synthetic accounts. Needs
     approval for the accounts.
4. **Frontend moves to v2** (coordinated with the Inventory/Dashboard frontend work):
   - Dashboard reads use `/api/v2/events` and `/api/v2/guests?eventId=`.
   - The booking page uses one call, `GET /api/v2/bookings/{id}`, instead of three (`/api/bookings/{id}`,
     `/api/events/search`, `/api/events/{id}`).
5. **v2 write endpoints:** event edit, guest import and allocation, owner-checked through the same `decide`. Not built
   yet.
6. **Legacy list endpoints:** after all consumers have moved and a deprecation window, restrict `GET /api/events` and
   `GET /api/guests`. This needs explicit approval. Share and booking links keep working through the server pages and
   v2.
7. **Guest links:** replace UUID-as-secret links with revocable, scoped tokens (`rollout.md`, stage 3).

Rollback at any point: unset `OWNER_SCOPE_API`, and the legacy routes are untouched.

## Public endpoint resource review (uploads, optimisation, geocoding)

| Endpoint | Validation and bounds | Remaining risk |
|---|---|---|
| `POST /api/procurement/plan` | `asOf` required; 1–2,000 items; 4 MB body; ≤ 120 history rows per item; `forecastAsOf` and `availableAt` validated. **New:** 20 valid plans per minute per client and instance (429 + `Retry-After`; invalid requests do not count) | Per-instance limit only, so serverless instances do not share counts. CPU time is bounded by the item cap: 2,000 items take about 7.6 s on a 2-vCPU sandbox |
| `GET /api/geocode` | Query validated; 30 per minute per client and instance; provider throttled to 1 request/s, 5 s timeout, 24 h cache; honest outcomes (branch commit 9440b75) | Per-instance limits; provider terms require a contact (`GEOCODER_CONTACT`) |
| `POST /api/ai/parse` | Streamed body ≤ 4.3 MB before multipart parsing; ≤ 2 MiB per file; local parsing only (no paid API) | Compressed formats (XLSX, DOCX) can expand far beyond the upload size (`upload-hardening.md`). No rate limit |
| `POST /api/guests/import` (legacy) | ≤ 500 rows; email and phone format checks | No auth; no byte limit beyond the platform's request limit; writes into any event by id |
| Other legacy JSON routes | Field checks vary | No auth and no application byte limit; listed above |

Not changed here: the legacy routes, to preserve current behaviour and links. Restricting them is step 6 and needs
approval.
