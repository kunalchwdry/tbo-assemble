# Booking capabilities and the legacy booking-link bridge

Status (17 Nov 2026): **built and tested on an isolated database; NOT live** (needs the schema migration and
`OWNER_SCOPE_API=1`). Code: `src/lib/access/booking-capability.ts`. Tests: `tests/owner-scope-db.test.ts`.

## Problem

Today the confirmation URL is `/booking/<bookingId>`. The booking id is effectively a password that never expires and
cannot be revoked. It may already have leaked through logs, Referer headers and the unauthenticated `/api/bookings`
and `/api/events` routes. The booking page also makes three calls, one of which returns the whole event.

## Design

- **Link capability.** The event owner issues it with `POST /api/v2/bookings/{id}/access` and
  `{"scope":"view"|"upgrade","expiresInDays":1–365}`; the default is view for 90 days.
  - The token is 32 random bytes (256 bits), base64url, shown **once**. Only its SHA-256 hash is stored, and a
    database CHECK refuses anything that is not a hash.
  - The URL carries it in the **fragment**: `https://…/booking/access#<token>`. Browsers never send the fragment to the
    server, so it stays out of request logs and Referer headers.
- **Exchange.** The page reads the fragment and sends `POST /api/v2/booking-access/exchange {"token":"…"}`.
  - On success it receives a **session cookie**: `tbo_booking_session`, HttpOnly, SameSite=Lax, `Path=/api/v2`, Secure
    on https. The cookie is bound to that one booking, carries the link's scope, and lasts at most 12 hours (never
    longer than the link).
  - The page then removes the fragment (`history.replaceState`) and loads `GET /api/v2/bookings/{id}`.
- **What a holder sees:** that booking, the guest's **name only** (no email or phone), the allowed actions and the
  event's public fields. Not other guests, internal ids, rules or the agent.
- **Revocation.** `DELETE /api/v2/bookings/{id}/access` revokes every link **and live session** of the booking at once.
  The owner can then issue a new link.
- **Failures** (unknown, altered, revoked or expired tokens) all return the same 404 body. Exchanges are limited per
  client (10 a minute, per server instance) and require a same-origin request.

## Legacy URLs (compatibility bridge)

URLs sent before this change keep working through `POST /api/v2/booking-access/legacy {"bookingId":"…"}`. It turns the
booking id into a **view-only session of 2 hours**. Safeguards:

- Uniform 404 for unknown ids.
- Same-origin only and rate-limited.
- Each use is audited, with the booking pseudonymised.
- Switch it off with `LEGACY_BOOKING_LINKS=0` (it then answers 410 "ask the organiser for a new link").

**Residual risk, stated plainly:** while the bridge is on, anyone holding a leaked booking id can still view that
booking. It no longer reveals contact data or other guests, and changes are no longer possible through it. Sunset plan:

1. Monitor `booking.access.legacy` audit lines.
2. Owners reissue links for active trips.
3. With approval, set `LEGACY_BOOKING_LINKS=0`.
4. Later, restrict the legacy `/api/bookings/{id}` route.

## Frontend integration (not done here; owned by the frontend work)

1. New page `/booking/access`: read `location.hash`, call the exchange, `history.replaceState` to drop the hash, then
   route to `/booking/<bookingId>`. The page must not load third-party resources.
2. `/booking/[bookingId]`:
   1. Call `GET /api/v2/bookings/{id}`.
   2. On 401, call the legacy bridge once with the id from the URL, then retry.
   3. Replace the three legacy fetches with this single call.
3. Upgrades still use the legacy route. A scoped v2 upgrade is future work.
