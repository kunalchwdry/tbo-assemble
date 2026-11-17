-- Read-only check of row-level security and Data API grants (plan §2 "verify deployed RLS", §5 least privilege).
-- Run in the Supabase SQL editor of the PRODUCTION project by someone with access. It reads the system catalog only:
-- no table rows, no personal data, no changes. Paste the two result tables into the security review.
--
-- Expected:
--   * every legacy Prisma table (Agent, Event, Guest, Booking, ...): rls_enabled = true and NO policy for anon or
--     authenticated (the app reaches them through Prisma, which bypasses RLS; the Data API must see no rows).
--     Better still: anon_select / authenticated_select = false (revoke the grants; see the note at the end).
--   * private_* tables: rls_enabled = true, anon has no privileges, authenticated has only the owner policies from
--     docs/security/private-*.sql (select/insert/delete own; no update except where the workspace SQL adds it).
--   * EventMember / BookingAccess (after the 2026-11-17 migration): rls_enabled = true, no policies, no grants.

-- 1. Per table: RLS state and what the Data API roles may do.
SELECT c.relname                                              AS table_name,
       c.relrowsecurity                                       AS rls_enabled,
       c.relforcerowsecurity                                  AS rls_forced,
       has_table_privilege('anon', c.oid, 'SELECT')           AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
         OR has_table_privilege('anon', c.oid, 'DELETE')      AS anon_write,
       has_table_privilege('authenticated', c.oid, 'SELECT')  AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
         OR has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_write,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relrowsecurity, c.relname;

-- 2. Every policy, with the roles it applies to and its conditions. A policy that is true for everyone, or one for
--    anon/authenticated on a legacy table, is a finding.
SELECT tablename, policyname, cmd, roles, permissive, qual AS using_expr, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

-- Note (needs approval; do not run as part of this check): the defence-in-depth fix for legacy tables is
--   REVOKE ALL ON public."Agent", public."Event", public."Guest", public."Booking", ... FROM anon, authenticated;
--   plus ALTER DEFAULT PRIVILEGES so future Prisma tables are not granted to the Data API roles.
-- Prisma connects as the database owner and is unaffected; confirm no client code uses supabase.from('<legacy table>').
