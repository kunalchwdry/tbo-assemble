# Supabase Auth rollout — not yet production-ready

> Owner-scoped access to the legacy events, guests and bookings (event-level ownership, booking capabilities) is
> planned in [`event-ownership.md`](event-ownership.md); current status and residual risk are in [`README.md`](README.md).


The `/login` page uses Supabase Auth, and `/secure-account` verifies identity through `getUser()`.
The account can create, edit and delete private event drafts and room blocks using
a user-token Supabase client and owner-scoped RLS. Private events remain separate from the old
dashboard and support a private guest planning list, but not guest invitations or bookings. The existing public event and
booking routes are not protected by this preview.
Do not use the current deployment for real customer data.

Next stages before switching login:
1. Apply a reviewed additive ownership migration. Existing agents/events remain
   unowned; never claim a record solely by matching an email address. Decide on
   a separately authorized ownership transfer for existing records.
2. Implement verified server-side user-to-agent mapping and scope *every* query
   and mutation, including nested resources and server-rendered pages. Prisma
   connects with elevated DB credentials and bypasses Supabase RLS, so RLS alone
   does not protect these endpoints.
3. Replace guest UUID-as-secret links with revocable, scoped tokens; add CSRF,
   rate limiting, session refresh and safe account recovery; keep demo synthetic.
4. Test unauthenticated, cross-user, demo, expired-session and guest access;
   audit all endpoints and file exports. Only then replace the legacy login.
5. Configure the Supabase site and redirect URLs for the final production host,
   verify email confirmation and recovery end-to-end, and test the live rollout.


## Private draft rollout

`docs/security/private-event-drafts.sql` creates a new, separate table with RLS, owner derived from `auth.uid()`, and column-level insert permissions; clients cannot supply the owner or ID. The subsequent workspace migration adds owner-only updates and deletes. Account deletion cascades to that user's drafts. Legacy records are not migrated or claimed. The server verifies `getUser()` and queries using the caller's token and an explicit owner filter, rather than the elevated Prisma connection.

Local PostgreSQL RLS tests and real Supabase synthetic-account browser/API tests exercise owner operations, cross-user denial and anonymous denial. Real email confirmation remains disabled. Any service-role or database owner connection can bypass RLS. This feature does not secure legacy APIs, guest links, booking data, or provide rate limiting; it is not a complete private event workspace.

## Private events and room blocks

`private-event-workspace.sql` extends the existing owner-scoped drafts with owner-only edit and delete, and creates a separate private room-block table. The composite `(event_id, owner_id)` foreign key ensures a child cannot attach to another owner's event; owner and parent columns cannot be supplied or changed except for choosing a parent at insertion. RLS and restricted column grants enforce access even for direct API calls. Deleting a draft cascades its room blocks. The workspace uses the caller's Supabase session and revalidates identity, never privileged Prisma. Existing shared events, bookings and guest links are untouched. Room blocks are planning records, not live inventory, guest bookings or supplier commitments. Email ownership is unverified: do not enter sensitive information. This does not secure legacy endpoints.

## Private guest planning list

`private-event-guests.sql` adds a separate owner-scoped guest list for private event drafts, with database-generated IDs and owners, a composite foreign key to the same owner's event, owner-only RLS and column-level write privileges. A serialized trigger caps each account at 1,000 guest rows. Deleting a private draft cascades its guest list. Local PostgreSQL tests cover cross-user access, owner spoofing, reparenting, anonymous access and the quota; a local fake-auth UI test is not proof of real Supabase sign-in behavior. A guest record is only a planning record: it does not send an invitation, create a guest link or reserve a room. These tables do not secure or migrate legacy events, guests or bookings. Email confirmation remains disabled; do not enter real customer data yet.

The response headers add no-store directives for event, booking, guest and account areas and restrict cross-origin referrers. This reduces caching and referral leakage, but does not provide authorization or make the legacy data private.
