# Security change log: branch `security/owner-scope-s1`

Base: `main` at `195fd1c` (production). This branch has not been pushed or deployed and has not touched a real
database. Each entry says what changed, why, and how it was checked. Status and residual risk:
[`README.md`](README.md).

## Baseline (195fd1c)

| Check | Result |
|---|---|
| Unit tests | 70 files: 68 pass. 2 fail for environment reasons: `plan-api.test.ts` needs a server on 127.0.0.1:3000, and `booking-capacity.integration.test.ts` refuses to run without its own isolated database |
| Type check | 0 errors |
| Lint (whole repo) | 49 errors, 40 warnings (pre-existing; per-file counts recorded) |
| Build | passes (needs about 3 GB of swap in the 2 GB sandbox) |
| Route inventory | 51 API routes. 43 have no identity check, and 24 of those write data. 23 should not be public; all 17 server pages that query the database have no identity check |

## 1. Inventory and isolated test environment (plan phase 0)

- `scripts/security-route-inventory.ts` writes `route-inventory.{json,md}`. It is a static scan, and `--check` fails on
  unclassified routes. For each route it records methods, the identity source, the Prisma models read and written,
  relation loads, rate limiting, outbound calls and the front-end callers.
- v2 routes are described by the handler they delegate to, so a public endpoint is never reported as "owner policy".
- Prisma `_count` selections are not reported as data loads.
- `scripts/security-migration-check.sh` refuses any non-local database.
- `scripts/security-restore-drill.sh`: `pg_dump`, restore into a scratch database, then compare per-table counts, the
  schema (Prisma diff) and an `Event` checksum. It prints counts only.

## 2. Event-level ownership and booking capabilities: schema (phases 1 and 3)

- `prisma/schema.prisma` adds `EventMember` (owner, editor or viewer; soft revocation; approval reference, no emails)
  and `BookingAccess` (link or session; view or upgrade scope; SHA-256 hash only; expiry; revocation).
- `migrations/2026-11-17-event-ownership.up.sql` is additive. It adds CHECK constraints, turns RLS on with no
  policies, and revokes access from `anon`/`authenticated`. `…down.sql` drops only the two new tables.
- Migration check: 13/13.

## 3. Owner-scoped API (phases 1 and 2), off unless `OWNER_SCOPE_API=1`

- `src/lib/access/`: identity from Supabase `getUser()` only. The membership condition sits inside every Prisma query.
- Inserts lock the membership row, and status changes are compare-and-set.
- Status codes: identical 404 for missing and foreign records; 401 for anonymous callers; 403 for viewers writing.
- Each write is checked in this order:
  1. same-origin;
  2. identity;
  3. JSON body of at most 64 KB;
  4. field allowlist;
  5. ownership.
- Routes: `GET/PATCH /api/v2/events/{id}`, `POST …/status`, `GET/POST /api/v2/guests`, `PATCH/DELETE /api/v2/guests/{id}`
  (deleting is refused while a booking is active), and `GET /api/v2/events`.
- Responses are no-store, nosniff and no-referrer. A JSON audit line with pseudonyms is written per action.

## 4. Public view and booking links (phases 2 and 3)

- `GET /api/v2/public/events/{slug}`: allowlisted fields, active or published events only. It shows `available`
  instead of internal counts and never includes the id, guests, agent or rules.
- `POST/DELETE /api/v2/bookings/{id}/access`, owner only: issue links (`/booking/access#<token>`) or revoke every
  link and session.
- `POST /api/v2/booking-access/exchange` exchanges a token for an HttpOnly session cookie: SameSite=Lax,
  `Path=/api/v2`, at most 12 hours, never longer than the link.
- `POST /api/v2/booking-access/legacy`: an old booking URL gets a 2-hour view-only session; `LEGACY_BOOKING_LINKS=0`
  returns 410.
- Rate limits are per instance only: exchange 10 a minute, public reads 120 a minute.

## 5. Approved ownership mapping (phase 1.3)

- `src/lib/access/ownership-mapping.ts` and `scripts/security-ownership-mapping.ts`.
- The default is a dry run, which checks:
  - each event exists;
  - each user exists in `auth.users` (if reachable);
  - the role;
  - duplicates;
  - existing owners.
- The output shows only counts and user-id prefixes, plus a fingerprint.
- `--apply --confirm <fingerprint>` writes every grant in one transaction with the approval reference.
- The database URL comes only from `MAPPING_DATABASE_URL`.
- `tests/ownership-mapping.test.ts`: 4/4 on the isolated database.

## 6. Public event page loads less data

`src/app/event/[slug]/page.tsx` previously loaded every guest record (email, phone, notes) and the whole agent row
(including `password`) on each anonymous view, in order to show a confirmed-guest count and the organiser's email.
- It now loads a filtered `_count` and `agent.email` only.
- Rendered values are identical: checked on the isolated database with synthetic data (old and new queries compared,
  confirmed count 4/7).
- No markup changed.

## 7. Response headers fixed in the Next config

The HTTP smoke test showed that the `/:path*` entry in `next.config.ts` (`Referrer-Policy: same-origin`) overrides the
route handlers' own `no-referrer`. Config headers win, and among config entries the last match wins.
- `next.config.ts` now adds no-store and `no-referrer` for `/api/v2/*` and `/booking/*`, after the global entry.
- `tests/security-headers.test.ts` pins the effective headers per path. It fails if the entry is removed (checked).

## 8. Documentation

- New: `event-ownership.md`, `booking-capabilities.md`, `verify-deployed-rls.sql`, `README.md` (status, evidence,
  residual risk, decisions), and this log.
- `owner-scoped-migration.md` and `ownership-migration.sql` (the agent-level draft) are marked **superseded**.

## 9. Deployed Supabase configuration check (read-only)

- The Supabase connector (organisation `tbo`) reached the production project. It ran SELECT queries on the system
  catalog and read the auth settings: no table rows, no changes.
- RLS is on for all 28 public tables, and the `ensure_rls` event trigger covers new ones. The legacy tables have no
  policies, and `anon`/`authenticated` cannot bypass RLS.
- Those roles still hold full grants on 20 tables through the default privileges. Revoking them needs approval.
- Saved plans and quote reviews are deployed exactly as the repo SQL (this closes the plan's "verify deployed RLS"
  item).
- The ownership migration is not applied.
- Sign-ups are open with email confirmation off (left unchanged).
- Details: `README.md`, "Deployed configuration".

## 10. Production: ownership migration and mapping (approved by the project owner)

The owner approved three things through the chat's question form:
- the account, named by them and resolved to exactly one Supabase user;
- all 8 events (including a "Copy of …" draft created that day through the open dashboard);
- going ahead without a data dump.

What was done:
- Snapshot of all 28 tables: exact row counts plus catalog checksums.
- Up migration applied as Supabase migration `20261117173521 event_ownership_and_booking_access`. Verified: RLS on,
  0 policies, no `anon`/`authenticated` privileges, 11 constraints, 6 indexes, and a snapshot identical to the one
  before.
- Ownership mapping, fingerprint `70214dc6e305`. Dry run 8/8 OK; applied in one statement that refuses anything but
  exactly 8 rows. Result: 8 active owners, 1 per event. Snapshot still identical.
- Live site unchanged (pages 200, `/api/v2` 503).
- The application code is still not deployed.
- Undo queries: `README.md`, "Production changes".

## Verification at the end of this branch (17 Nov 2026)

| Check | Result |
|---|---|
| Unit tests | 72 files: **70 pass**. The same 2 environment-dependent files fail as at baseline. 237 test cases pass. Both database suites skip explicitly without `TEST_DATABASE_URL` |
| Isolated PostgreSQL 17 suites | `owner-scope-db` 12/12 (3 consecutive runs, and after the final type fixes); `ownership-mapping` 4/4 |
| Mocked handler tests | 16/16 |
| Mutation check | 11/11 planted authorization bugs caught |
| Type check | 0 errors |
| Lint (whole repo) | 49 errors, 40 warnings in 472 files; per-file counts identical to the baseline; 0 in new or changed files |
| Build | exit 0, 44/44 static pages, 10 v2 routes dynamic |
| HTTP smoke test (`next start` + isolated DB) | flag off 5/5, flag on 14/14 |
| Restore drill (synthetic) | counts, schema and `Event` checksum identical |
| Local RLS tests for saved plans and quote reviews | pass, including after the v4 and v5 migrations |
| Live, read-only | the Data API shows anonymous users 0 rows in all 17 legacy tables; the private tables answer 401. No rows were requested |
