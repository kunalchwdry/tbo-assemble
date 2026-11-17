# Event-level ownership: design, migration and rollout

Status (17 Nov 2026): **built and tested on an isolated database; NOT applied to production; the API is off.**
This is section 3.3 of the security implementation plan, as chosen by the project owner: **event-level ownership**.

## Why event-level

All 7 legacy events belong to one `Agent`. With agent-level ownership (the superseded `Agent.authUserId` draft), giving
one account that agent would hand over all 7 events and every future event of that agent at once. With a membership
table, every grant names one event and one verified Supabase user. Shared access and roles come with it.

## Model

`EventMember` (`prisma/schema.prisma`):

| Column | Meaning |
|---|---|
| `eventId` | the event (cascade: deleting an event removes its memberships) |
| `authUserId` | Supabase Auth user id (`auth.users.id`); never an email |
| `role` | `owner` (read, write, issue/revoke booking links), `editor` (read, write), `viewer` (read) |
| `grantedBy` | approval reference; a CHECK refuses anything containing `@` |
| `revokedAt` | soft revocation; takes effect on the next request |

- Unique `(eventId, authUserId)`.
- An event without an active row is **unclaimed**: the owner API (`/api/v2/*`) never lists, shows or changes it.
  Its public page and booking links behave exactly as today.

## How access is enforced

Prisma connects with elevated credentials and bypasses RLS, so the rule is enforced in code, inside each query
(`src/lib/access/owner-repo.ts`):

- **Identity.** Supabase `auth.getUser()` verifies the session with the Auth server. A user id, role or email sent in
  the request is never trusted. Any auth error is treated as anonymous, which fails closed.
- **Reads** filter by the record id and an active membership of that user.
- **Updates and deletes** carry the membership condition in the write itself (`updateMany` / `deleteMany`).
- **Inserts** lock the caller's membership row (`FOR SHARE`) in the same transaction, so a concurrent revocation waits
  and wins.
- **Status changes** are compare-and-set on the current status.
- **Child records:** a guest or booking must belong to an event the user is a member of; an explicit `eventId` must
  match.
- **Status codes:**
  - anonymous: 401;
  - someone else's resource, an unclaimed one, or a missing one: the identical 404;
  - a viewer trying to write: 403.
- **Every response** is `Cache-Control: no-store`. Writes need a same-origin request (CSRF) and a JSON body of at most
  64 KB.
- **Audit log:** every v2 action writes one JSON line containing the action, result, status, request id, event id and
  **pseudonyms** of the actor and resource. It never includes emails, tokens, bodies or raw user/booking ids.

Email verification is left exactly as configured in Supabase. An account only ever gets events that an approved
mapping names by its exact user id.

## Endpoints (all answer 503 unless `OWNER_SCOPE_API=1`)

| Method and path | Who |
|---|---|
| `GET /api/v2/events` | signed-in user: their events and their role on each |
| `GET /api/v2/events/{eventId}` | members: the full event (guests, bookings, rooms, add-ons, attrition rules) |
| `PATCH /api/v2/events/{eventId}` | owner/editor: name, type, venue, location, description, dates, expected pax, colours, https hero image. `slug`, `status`, `agentId` and unknown fields are refused |
| `POST /api/v2/events/{eventId}/status` | owner/editor: the same transition table as the legacy route |
| `GET /api/v2/guests?eventId=` | members |
| `POST /api/v2/guests` | owner/editor |
| `PATCH /api/v2/guests/{guestId}` | owner/editor (allowlisted fields) |
| `DELETE /api/v2/guests/{guestId}` | owner/editor; refused (409) while the guest holds an active booking, so capacity stays right |
| `GET /api/v2/bookings/{bookingId}` | members (full booking), or the holder of a booking session ([`booking-capabilities.md`](booking-capabilities.md)) |
| `POST/DELETE /api/v2/bookings/{bookingId}/access` | event owner: issue or revoke booking links |
| `GET /api/v2/public/events/{slug}` | anyone: public fields of an active or published event only |
| `POST /api/v2/booking-access/exchange`, `/legacy` | booking-link holders ([`booking-capabilities.md`](booking-capabilities.md)) |

**Not covered yet:** owner-side booking changes (cancel, move room, check-in), allocation, rooming lists, QR, nudges,
vendors, RFPs, schedule and the other legacy sub-routes. See [`route-inventory.md`](route-inventory.md).

## Migration (needs approval)

`migrations/2026-11-17-event-ownership.up.sql`:

- Additive: it creates `EventMember` and `BookingAccess` with CHECK constraints, and no existing table or row changes.
- Locks both tables away from the Supabase Data API: RLS is on with no policies, and the grants to
  `anon`/`authenticated` are revoked.

`…down.sql` drops only those two tables.

`bash scripts/security-migration-check.sh` verifies both files in a scratch database. On 17 Nov 2026 all 13 checks
passed:

- Prisma reports no drift after the up step;
- the down step restores today's schema;
- existing rows survive;
- re-running fails atomically;
- bad roles, email references and raw tokens are refused by the database.

Not included on purpose: a foreign key to `auth.users`. Prisma cannot introspect cross-schema references (error
P4002), which would break `prisma db pull` / `migrate diff`. A membership whose Auth user was deleted grants nothing,
because no session can exist for that user. Periodic cleanup, run with approval:

```sql
UPDATE "EventMember" m SET "revokedAt" = now()
WHERE "revokedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m."authUserId");
```

## Assigning owners (needs approval; default = all 7 events stay unclaimed)

1. Inspect the events by id and counts only. Never log names or contact data.
2. Write a mapping file that names each grant exactly:

   ```json
   {"approval":{"approvedBy":"…","reference":"…","date":"YYYY-MM-DD"},
    "grants":[{"eventId":"…","authUserId":"…","role":"owner"}]}
   ```

3. Dry run: `MAPPING_DATABASE_URL=… npx tsx scripts/security-ownership-mapping.ts mapping.json`.
   - The dry run checks each event exists, each user exists in `auth.users`, the role, duplicates and existing owners.
   - It prints counts, user-id prefixes and a **fingerprint**.
4. Apply: add `--apply --confirm <fingerprint>`. All grants go in one transaction, recording the approval reference.
   Add `--report out.json` to keep a record.
5. Undo one mapping: `UPDATE "EventMember" SET "revokedAt" = now() WHERE "grantedBy" = '<reference>';`

Ownership is never inferred from an email that resembles the agent's. Tested in `tests/ownership-mapping.test.ts`.

## Rollout (each step needs explicit approval)

1. **Backup and restore drill** of production with `scripts/security-restore-drill.sh`, restoring into an isolated
   database. (The drill is tested on synthetic data only.)
2. **Apply the up migration** to production. The app is unaffected: nothing queries the new tables while
   `OWNER_SCOPE_API` is off.
3. **Create approved synthetic accounts** and set `OWNER_SCOPE_API=1` **on a preview only**. Test real Supabase sign-in
   with the mapping tool on synthetic events.
4. **Map the 7 events**, or leave them unclaimed.
5. **Move the dashboard and booking page to v2** behind a reversible switch. Compare aggregate counts and errors.
6. **Restrict the legacy routes** (separate approval).

Rollback: switch `OWNER_SCOPE_API` off, then optionally run the down migration. Rolling back never means re-opening the
legacy routes silently.
