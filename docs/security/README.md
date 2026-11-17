# Security work: status, evidence and residual risk

Branch `security/owner-scope-s1`, based on `main` at `195fd1c`. Last updated 17 Nov 2026.
Implements the security implementation plan in stages. **Nothing here is deployed.**

- Production runs `195fd1c`; this branch has not been pushed.
- The new API is off (`OWNER_SCOPE_API` unset → 503).
- No real database has been migrated.
- No record has been assigned an owner.

**This branch does not make the application secure.** The legacy routes and dashboard pages listed below still expose
private data to anyone until the cutover steps are approved and done.

## What exists

| Plan item | Where | State |
|---|---|---|
| Inventory of every route, method, server page and action (§0, §9) | [`route-inventory.md`](route-inventory.md) / `.json`, from `scripts/security-route-inventory.ts` (`--check` fails on unclassified routes) | done (static scan) |
| Event-level ownership (§1) | `EventMember` in `prisma/schema.prisma`; [`event-ownership.md`](event-ownership.md) | built, off |
| Additive migration with rollback (§1, §4) | `migrations/2026-11-17-event-ownership.{up,down}.sql`, checked by `scripts/security-migration-check.sh` | tested on isolated DB, **not applied** |
| Approved ownership mapping with dry run (§1) | `scripts/security-ownership-mapping.ts` (fingerprint + approval reference, one transaction, no emails) | tested on isolated DB, **not run on real data** |
| Server-side authorization inside queries (§1, §5) | `src/lib/access/` (`owner-repo.ts` has the membership condition in every query, row lock on inserts, compare-and-set status) | built, off |
| Owner-scoped v2 reads **and writes** (§2) | `src/app/api/v2/{events,guests,bookings}` | built, off |
| Public DTO (§2) | `GET /api/v2/public/events/{slug}`: allowlisted fields, active/published only | built, off |
| Public page loads less data (§2) | `src/app/event/[slug]/page.tsx` no longer loads guest records or the agent's password; render unchanged | done |
| Booking capabilities (§3) | `BookingAccess`; [`booking-capabilities.md`](booking-capabilities.md): 256-bit tokens (hash only), fragment links, HttpOnly session, revocation | built, off |
| Legacy booking-URL bridge with switch (§3) | `POST /api/v2/booking-access/legacy`, `LEGACY_BOOKING_LINKS=0` → 410 | built, off |
| Response headers (§6) | v2 and `/booking/*`: no-store, nosniff, `Referrer-Policy: no-referrer` (`next.config.ts`; pinned by `tests/security-headers.test.ts`) | done in config |
| Audit log without personal data (§6) | one JSON line per v2 action; actor and resource pseudonymised | built, off |
| Backup / restore drill (§0) | `scripts/security-restore-drill.sh` (counts, schema and checksum comparison) | tested on synthetic data only |
| Deployed RLS check (§2, §5) | [`verify-deployed-rls.sql`](verify-deployed-rls.sql) (catalog only); results under "Deployed configuration" below | **done, read-only, 17 Nov 2026** |

## Evidence (17 Nov 2026)

| Check | Result |
|---|---|
| Type check `npx tsc --noEmit -p .` | 0 errors |
| Whole-repo lint `npx eslint .` | 49 errors, 40 warnings in 472 files. Identical per file to the recorded baseline (all pre-existing); 0 in new or changed files |
| Unit suite (`tests/*.test.ts`, one file at a time) | 72 files: 70 pass, 237 test cases. The same 2 environment-dependent files fail as at baseline (`plan-api` needs a server on :3000; `booking-capacity.integration` needs its own database) |
| Mocked handler tests `tests/owner-scope.test.ts` | 16/16 |
| **Real PostgreSQL** `tests/owner-scope-db.test.ts` (isolated, synthetic) | 12/12 on 3 consecutive runs, and again after the final type fixes |
| **Real PostgreSQL** `tests/ownership-mapping.test.ts` | 4/4 (dry run writes nothing, refusals, all-or-nothing apply, second-owner guard) |
| Mutation check: 11 deliberately planted authorization bugs | 11/11 caught by the suites (viewer writes, bare booking id accepted, session not bound to booking, missing row lock, list ignores membership, cross-event guest id, revoked link accepted, public view leaks fields, CSRF check off, status without compare-and-set, raw actor id in audit log) |
| Migration check `scripts/security-migration-check.sh` | 13/13 (no Prisma drift, rollback restores the schema, existing rows kept, re-run fails atomically, CHECKs refuse emails and raw tokens) |
| HTTP smoke test: production build (`next start`) + isolated database | flag off: 5/5 (every v2 route 503, public page renders). Flag on: 14/14 (anonymous 401, identical bodies for real and random ids, allowlisted public DTO, draft 404, cross-site 403, unknown token 404, cookie HttpOnly/SameSite=Lax/Path=/api/v2 lasting 12.0 h, guest name only, no access to other bookings or owner routes). No token or guest data in the server log. This test found that `next.config.ts` overrode the handlers' `no-referrer`; fixed, then re-run |
| Production build `npm run build` | exit 0, 44/44 static pages, the 10 v2 routes dynamic |
| Local RLS tests for saved plans and quote reviews (`tests/private-*-rls.sql`) | all pass on a throwaway cluster, including after the v4 and v5 model-version migrations |
| Live, read-only: Supabase Data API with the public key, HEAD + count, no rows returned | 17 legacy Prisma tables: HTTP 200, **0 rows visible** to anonymous users. `private_inventory_plans`, `private_quote_reviews`, `private_event_drafts`: HTTP 401 (no anonymous privileges) |
| Live, read-only: production Supabase catalog and auth settings (connector, SELECT on system catalogs only) | See "Deployed configuration" below. Nothing was changed and no table rows were read |

Not evidence of security:
- None of the above ran v2 against real Supabase Auth: identity was injected in the tests. The production project is now
  reachable through the connector, but only read-only checks were made.
- No database was migrated, and no load test was done.

## Deployed configuration (production Supabase project `tvrb…mjzp`, read-only check, 17 Nov 2026)

The connector ran SELECT queries on the system catalog only (tables, policies, grants, functions, roles, event
triggers) and read the auth settings. No table rows were read, and nothing was changed.

| Area | Finding |
|---|---|
| Where the data lives | The 17 legacy Prisma tables are in this project, with real data (planner estimates: about 8 events, 143 guests, 107 bookings). There is no `_prisma_migrations` table, so the schema is managed with `prisma db push` |
| RLS | **On for all 28 public tables.** The active event trigger `ensure_rls` (function `rls_auto_enable`) turns RLS on for every new table created in `public`, so future Prisma tables get it too. None of the 17 legacy tables has a policy, so the Data API returns no rows to `anon` or `authenticated`. Neither role can bypass RLS. The owner role `postgres` can, which is why the app (Prisma) still reads the tables |
| Grants | `anon` and `authenticated` hold **full privileges** (select, insert, update, delete, truncate, …) on the 17 legacy tables, `market_fare_observations` and the two `serpapi_*` tables, through the schema's default privileges. Today only RLS stands in the way; one mistaken permissive policy would open a table. The research tables (`route_forecast_evidence`, `traffic_research_*`) have no grants |
| Saved plans and quote reviews | **Deployed exactly as `private-inventory-plans.sql` / `private-quote-reviews.sql`.** RLS on; owner-only select, insert and delete via `auth.uid()`; no update; insert limited to the same columns; no anonymous access. The same pattern holds for the private drafts, guests and room blocks, with owner-only update on the allowed columns |
| Views and functions | No views or materialised views in `public`. The two quota trigger functions run with owner rights (`SECURITY DEFINER`) but cannot be executed by `anon`/`authenticated`. `rls_auto_enable` is an event-trigger function and cannot be called through the API |
| Ownership migration | Not applied: `EventMember` and `BookingAccess` do not exist |
| Auth (settings read, **not changed**) | Sign-ups are open and email confirmation is off (`mailer_autoconfirm`), so anyone can create an account under any email address without proving it. The v2 design never trusts emails, and ownership is granted only by exact user id. Other settings: passwords at least 6 characters; leaked-password check off; captcha off; refresh-token rotation on; 1-hour access tokens; anonymous sign-ins off; redirect URLs limited to `/secure-account/callback`. There are 11 accounts |

## Residual risk (honest list)

**Exposed today in production (unchanged by this branch):**
1. **Legacy API.** 23 routes that should be owner-only have no identity check, and 24 routes write data without one
   ([`route-inventory.md`](route-inventory.md)). Anyone can:
   - list every event with guests (names, emails, phones, notes), bookings and rules (`GET /api/events`, `/api/guests`);
   - change or delete them, check guests in, read vendors and RFPs.
2. **Dashboard pages.** 15 `/dashboard/...` server pages query the database with no identity check and render guest and
   booking data to anyone with the URL. The same applies to every page in the inventory's server-page table.
3. **Demo agent password.** `POST /api/events` creates a demo agent with a hard-coded password when none exists.
4. **Booking URLs.** `/booking/{bookingId}` uses the bare booking id as a permanent secret. The page calls legacy
   endpoints that return the whole event.
5. **Public event page.** It shows the organiser's email address as a contact link. This may be intended; it is the
   project owner's decision.
6. **Data API grants.** RLS (with no policies) is the only barrier. `anon` and `authenticated` still hold full grants on
   the legacy tables, and new tables receive them by default. This was checked in the catalog, not with a real signed-in
   token.
7. **Open sign-up without email confirmation.** This is your setting and was left unchanged. Any account is
   unverified, so emails can never be used for authorization.

**Gaps in what this branch builds:**
1. **Not wired to real sign-in.** v2 has never run with real Supabase sign-in. That needs a preview with approved
   synthetic accounts.
   - Check first whether Vercel previews share the production `DATABASE_URL`. If they do, a preview with the flag on
     works on production data.
2. **Owner coverage.** Owner-side booking changes, allocation, rooming lists, QR, nudges, vendors, RFPs and schedule
   have no v2 equivalent yet. Those legacy routes cannot be restricted until replacements exist.
3. **Frontend not built.**
   - There is no `/booking/access` page; issued links point to it.
   - New bookings still return a bare id.
   - The booking page and dashboard still call legacy routes.
4. **Legacy bridge.** While it is on, a leaked booking id still gives a 2-hour view-only session for that booking
   (narrow view, no contact data, no changes).
5. **Rate limits are per server instance.** They are in memory, so on serverless they do not add up to a global limit.
6. **Audit pseudonyms.** They are unkeyed hashes: someone holding a list of user ids could link log lines to users.
   A keyed hash (`AUDIT_LOG_KEY`) would prevent that.
7. **Not started (plan §6 / phase 6):**
   - shared rate limits;
   - archive decompression caps for `/api/ai/parse` (XLSX/DOCX);
   - a site-wide CSP (report-only first);
   - CI gates;
   - login and reset throttling;
   - a production backup and restore drill.

## Decisions needed (nothing below happens without an explicit yes)

1. Push this branch, or create a Vercel preview (flag off).
2. Run the backup and restore drill on production. The dump contains personal data, so it must stay on an approved,
   encrypted machine.
3. Apply the up migration to production. It is additive, and the app is unaffected while the flag is off.
4. Name the approved synthetic accounts, then turn the flag on **for the preview only**.
5. Assign the 7 existing events with an exact mapping (event id → Supabase user id → role), or leave them unclaimed.
6. Approve or decline revoking the Data API grants (`anon`, `authenticated`) on the legacy, `market_fare_observations`
   and `serpapi_*` tables, and the matching default privileges for new tables. The app does not use them: Supabase client
   code only touches the `private_*` tables. The deployed RLS check itself is done (read-only).
7. Later, separately: move the booking page and dashboard to v2, switch off the legacy bridge, and restrict the
   legacy routes.
