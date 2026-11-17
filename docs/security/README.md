# Security work: status, evidence and residual risk

Branch `security/owner-scope-s1`, based on `main` at `195fd1c`. Last updated 17 Nov 2026.
Implements the security implementation plan in stages. **The application code here is not deployed.**

- Production runs `195fd1c`.
- This branch was pushed to GitHub (a public repo) on 17 Nov. Its Vercel preview built successfully (deployment
  `B4mYDw…`). Previews sit behind Vercel login. The owner opened it: database-backed pages fail there because
  `DATABASE_URL` is set for Production only (see "Decisions needed", item 1).
- The new API is off (`OWNER_SCOPE_API` unset → 503).
- **Production database (approved by the project owner, 17 Nov 2026):**
  - the additive ownership migration is applied;
  - the 8 events are assigned to one approved account;
  - the Data API grants on 20 server-only tables are revoked;
  - see "Production changes".
  - The running app does not use the ownership records yet.

**This branch does not make the application secure.** The legacy routes and dashboard pages listed below still expose
private data to anyone until the cutover steps are approved and done.

## What exists

| Plan item | Where | State |
|---|---|---|
| Inventory of every route, method, server page and action (§0, §9) | [`route-inventory.md`](route-inventory.md) / `.json`, from `scripts/security-route-inventory.ts` (`--check` fails on unclassified routes) | done (static scan) |
| Event-level ownership (§1) | `EventMember` in `prisma/schema.prisma`; [`event-ownership.md`](event-ownership.md) | built, off |
| Additive migration with rollback (§1, §4) | `migrations/2026-11-17-event-ownership.{up,down}.sql`, checked by `scripts/security-migration-check.sh` | tested on isolated DB; **applied to production 17 Nov 2026** (Supabase migration `20261117173521`) |
| Approved ownership mapping with dry run (§1) | `scripts/security-ownership-mapping.ts` (fingerprint + approval reference, one transaction, no emails) | tested on isolated DB; **production mapping applied 17 Nov 2026** (same checks, run through the Supabase connector) |
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
- The production migration is additive. Catalog checks and before/after snapshots verified it, not application
  traffic. No load test was done.

## Deployed configuration (production Supabase project `tvrb…mjzp`, read-only check, 17 Nov 2026)

This read-only check ran SELECT queries on the system catalog only (tables, policies, grants, functions, roles, event
triggers) and read the auth settings. No table rows were read, and nothing was changed. The approved changes made
afterwards are listed under "Production changes".

| Area | Finding |
|---|---|
| Where the data lives | The 17 legacy Prisma tables are in this project, with real data (exact counts on 17 Nov: 8 events, 142 guests, 107 bookings). Schema changes are recorded as Supabase migrations (13 before this work), and there is no Prisma migration history |
| RLS | **On for all 28 public tables.** The active event trigger `ensure_rls` (function `rls_auto_enable`) turns RLS on for every new table created in `public`, so future Prisma tables get it too. None of the 17 legacy tables has a policy, so the Data API returns no rows to `anon` or `authenticated`. Neither role can bypass RLS. The owner role `postgres` can, which is why the app (Prisma) still reads the tables |
| Grants | At the time of this check, `anon` and `authenticated` held **full privileges** (select, insert, update, delete, truncate, …) on the 17 legacy tables, `market_fare_observations` and the two `serpapi_*` tables, through the schema's default privileges, so only RLS stood in the way. **Revoked later that day** (see "Production changes"). The research tables (`route_forecast_evidence`, `traffic_research_*`) have no grants |
| Saved plans and quote reviews | **Deployed exactly as `private-inventory-plans.sql` / `private-quote-reviews.sql`.** RLS on; owner-only select, insert and delete via `auth.uid()`; no update; insert limited to the same columns; no anonymous access. The same pattern holds for the private drafts, guests and room blocks, with owner-only update on the allowed columns |
| Views and functions | No views or materialised views in `public`. The two quota trigger functions run with owner rights (`SECURITY DEFINER`) but cannot be executed by `anon`/`authenticated`. `rls_auto_enable` is an event-trigger function and cannot be called through the API |
| Ownership migration | Not applied at the time of this check; applied later that day (see "Production changes") |
| Auth (settings read, **not changed**) | Sign-ups are open and email confirmation is off (`mailer_autoconfirm`), so anyone can create an account under any email address without proving it. The v2 design never trusts emails, and ownership is granted only by exact user id. Other settings: passwords at least 6 characters; leaked-password check off; captcha off; refresh-token rotation on; 1-hour access tokens; anonymous sign-ins off; redirect URLs limited to `/secure-account/callback`. There are 11 accounts |

## Production changes (approved by the project owner, 17 Nov 2026)

| Step | What was done | Evidence |
|---|---|---|
| Approval | Given through the chat's question form. **Account:** the owner's sign-in account, named by the owner and resolved to exactly one Supabase user (id `c5b8819d…`). **Events:** all 8. **Production change:** go ahead without a data dump. This was the owner's choice: the change only adds tables, and a dump would copy guests' personal data into the work sandbox | Reference `R14-owner-mapping-2026-11-17` |
| Snapshot before | Exact row counts of all 28 tables, plus checksums of columns, constraints, policies, grants, indexes and RLS flags | taken 17:34:50 UTC |
| Migration | `migrations/2026-11-17-event-ownership.up.sql` (commit `4bfda34`), applied as Supabase migration `20261117173521 event_ownership_and_booking_access`. Its `BEGIN`/`COMMIT` lines were removed because the tool runs the migration in one transaction | Both tables: owner `postgres`, RLS on, 0 policies, no privileges of any kind for `anon`/`authenticated`, 11 constraints, 6 indexes, 0 rows |
| Snapshot after the migration | Identical to the snapshot before | 17:36:04 UTC |
| Ownership dry run | Every grant checked: event found, account found, valid role, no duplicate, no existing member. The fingerprint comes from the library's `fingerprint()`. The mapping file (ids only) is kept outside the repo | 8/8 OK, fingerprint `70214dc6e305` |
| Ownership apply | One statement inserts the 8 grants and rolls back unless exactly 8 rows go in. `grantedBy` holds the approval reference | 8 active owners, 1 per event, 0 events without an owner |
| Snapshot after the mapping | Identical to the snapshot before | 17:36:54 UTC |
| Live site | `/`, `/dashboard`, `/event/{slug}`: 200. `/api/v2/events`: 503 (flag off). The legacy API still lists 8 events | behaviour unchanged |

**Data API grants revoked (same day, approved by the owner).**

| Step | What was done | Evidence |
|---|---|---|
| Nothing uses them | Code search on all 8 branches of both GitHub repos: Supabase client `.from()` calls target only the `private_*` tables. `market_fare_observations` and `serpapi_*` are reached through Prisma raw SQL (database owner role). No `.rpc()`, live updates, REST/GraphQL calls or service keys. The project has no edge functions, no tables in a live-update publication and no GraphQL extension | `pg_stat_statements` since 13 Nov: the public roles ran only the 17 queries of the earlier read-only check (`authenticated`: none) |
| Snapshot before | Every grant on every public table | 20 target tables × 8 privileges × 2 roles = 320 grant rows; 490 other grant rows (checksum recorded) |
| Change | `migrations/2026-11-17-revoke-data-api-grants.up.sql` (one `REVOKE ALL … FROM anon, authenticated`), applied as Supabase migration `20261117174546 revoke_data_api_grants_server_only_tables` | 0 grant rows and no effective privilege left for `anon`/`authenticated` on the 20 tables. The other 490 grants, all RLS flags and all policies are unchanged (checksums equal) |
| From outside | Data API with the site's public key | Legacy and server-only tables: `401 permission denied` (previously `200` with 0 rows). `private_inventory_plans`: 401, as before |
| Live site | Pages; fare routes that read `market_fare_observations`; legacy API | `/`, `/dashboard`, `/event/{slug}`: 200. `/api/india-market/fares` and `/api/flight/seven-day`: 200 (15 fare rows). `/api/events`: 8 events. `/api/v2/events`: 503 |

Default privileges are **unchanged**: tables created in `public` from now on still receive full `anon`/`authenticated`
grants. The `ensure_rls` trigger still turns RLS on for them.

Undo (each needs the same kind of approval):
- Data API grants: `migrations/2026-11-17-revoke-data-api-grants.down.sql`.
- Ownership only: `UPDATE "EventMember" SET "revokedAt" = now() WHERE "grantedBy" = 'R14-owner-mapping-2026-11-17';`
- The whole schema change: `migrations/2026-11-17-event-ownership.down.sql` (drops only the two tables).

Notes:
- Nothing visible changes yet. Production code (`195fd1c`) does not read these tables, and the v2 API that does is not
  deployed.
- The owner chose the account by its email address. Sign-ups are not email-verified, so the owner should confirm it is
  the account they sign in with; otherwise, revoke as above.
- The 8th event was included at the owner's request. It is a draft "Copy of …" created on 17 Nov through the open
  dashboard; its creator is unknown.

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
6. **Data API defaults.** The grants on the 20 server-only tables are revoked. Tables created from now on still receive
   full `anon`/`authenticated` grants by default, so for them RLS is the only barrier. The logged-in (`authenticated`)
   side was checked in the catalog, not with a real signed-in token.
7. **Open sign-up without email confirmation.** This is your setting and was left unchanged. Any account is
   unverified, so emails can never be used for authorization.

**Gaps in what this branch builds:**
1. **Not wired to real sign-in.** v2 has never run with real Supabase sign-in. That needs an environment with a
   database and approved test accounts.
   - Vercel previews have no database (`DATABASE_URL` is Production-only), so they cannot run it as configured today.
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
7. **Schema drift until merge.** Production now has `EventMember` and `BookingAccess`, but `main`'s
   `prisma/schema.prisma` does not. Running `prisma db push` against production from `main` (or any branch without the
   two models) would offer to drop them, behind a data-loss prompt. Do not do it before this branch is merged.
8. **Not started (plan §6 / phase 6):**
   - shared rate limits;
   - archive decompression caps for `/api/ai/parse` (XLSX/DOCX);
   - a site-wide CSP (report-only first);
   - CI gates;
   - login and reset throttling;
   - a production backup and restore drill.

## Decisions needed (nothing below happens without an explicit yes)

Done on 17 Nov 2026 with the owner's approval (see "Production changes"):
- the up migration on production and the ownership mapping;
- revoking the Data API grants on the 20 server-only tables;
- pushing this branch, with a Vercel preview (flag off).

1. **Answered on 17 Nov.**
   - From the owner's Vercel settings: `DATABASE_URL` exists for Production only, so previews have no database. The
     Supabase URL and public key apply to all environments, so previews do use the real sign-in service.
   - Database-backed pages (dashboard, event pages, legacy API) fail on previews with "DATABASE_URL must be
     configured". The same build was run locally: it failed the same way without a database and worked normally with
     one. The branch does not touch those pages. Production's dashboard renders normally.
   - So previews never touch production data, but a v2 test on a preview needs a separate preview database first.
2. **Owner's choice (17 Nov): previews use the production database.** The owner chose this knowingly over a separate
   preview database. It means a flag-on preview acts on real events, so the preview checks are read-only. The owner
   sets the variables in Vercel; the work sandbox has no Vercel access.
   - `OWNER_SCOPE_API=1`: **Preview, branch `security/owner-scope-s1` only. Never Production.**
     - `main` (production, and every other branch's preview) still contains the superseded v2 code.
     - That code needs an `Agent."authUserId"` column that does not exist, so it would switch on and fail.
   - `DATABASE_URL`: recommended for the same branch only. All previews would also work, at the cost of real data in
     every preview.
   - Keep Vercel's preview login on; previews will show real data.
   - Test accounts: the owner's account for the owner checks. A second, non-owner account is optional but needed for
     the "another user sees nothing" check.
3. Run a production backup and restore drill before any change that alters existing tables or rows. The dump contains
   personal data, so it must stay on an approved, encrypted machine. The owner chose to skip it for the additive
   migration.
4. Decide owners for events created from now on. The legacy dashboard creates them unclaimed. v2 has no endpoint for
   creating events yet; when one is built, it should make the creator the owner in the same transaction.
5. Optional: change the schema's default privileges so new tables no longer grant `anon`/`authenticated` anything
   automatically. Any future table meant for the Data API would then need explicit `GRANT`s in its migration (the
   `private_*` migrations already do this).
6. Later, separately: move the booking page and dashboard to v2, switch off the legacy bridge, and restrict the
   legacy routes.
