-- Event-level ownership and booking capabilities: ADDITIVE schema change. Status: REVIEWED IN AN ISOLATED DATABASE ONLY.
-- Do not apply to production without explicit approval (docs/security/event-ownership.md, "Rollout").
--
-- * Creates two new tables. Existing tables, rows and queries are not touched; every existing event stays UNCLAIMED.
-- * Matches prisma/schema.prisma exactly (checked with `prisma migrate diff`, which reports no difference afterwards).
-- * Locks both tables away from the Supabase Data API: RLS on with no policies, and no grants to anon/authenticated.
--   The application reaches them only through the server (Prisma), which scopes every query in code.
-- * Rollback: 2026-11-17-event-ownership.down.sql (drops only these two tables).
BEGIN;

CREATE TABLE "EventMember" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "authUserId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "EventMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventMember_role_check" CHECK ("role" IN ('owner', 'editor', 'viewer')),
    CONSTRAINT "EventMember_grantedBy_check" CHECK ("grantedBy" IS NULL OR ("grantedBy" !~ '@' AND length("grantedBy") <= 200))
);

CREATE TABLE "BookingAccess" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'view',
    "tokenHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'issued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "BookingAccess_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingAccess_kind_check" CHECK ("kind" IN ('link', 'session')),
    CONSTRAINT "BookingAccess_scope_check" CHECK ("scope" IN ('view', 'upgrade')),
    CONSTRAINT "BookingAccess_source_check" CHECK ("source" IN ('issued', 'legacy-booking-url')),
    -- base64url SHA-256 (43 characters): a raw token can never be stored here by mistake.
    CONSTRAINT "BookingAccess_tokenHash_check" CHECK ("tokenHash" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "BookingAccess_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE INDEX "EventMember_authUserId_idx" ON "EventMember"("authUserId");
CREATE UNIQUE INDEX "EventMember_eventId_authUserId_key" ON "EventMember"("eventId", "authUserId");
CREATE UNIQUE INDEX "BookingAccess_tokenHash_key" ON "BookingAccess"("tokenHash");
CREATE INDEX "BookingAccess_bookingId_idx" ON "BookingAccess"("bookingId");

ALTER TABLE "EventMember" ADD CONSTRAINT "EventMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingAccess" ADD CONSTRAINT "BookingAccess_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No foreign key to auth.users: Prisma cannot introspect cross-schema references (error P4002), which would break
-- `prisma db pull` / `migrate diff` against the Supabase database. A membership whose Auth user was deleted grants
-- nothing (no session can exist for that user); docs/security/event-ownership.md has the cleanup query.

-- No Data API access: RLS on with no policies denies anon/authenticated; revoke the default Supabase grants too.
ALTER TABLE "EventMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingAccess" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "EventMember", "BookingAccess" FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
