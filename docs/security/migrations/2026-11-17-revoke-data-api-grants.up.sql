-- Least privilege for the Supabase Data API (security plan §5). Approved by the project owner on 17 Nov 2026.
-- These 20 tables are used only by the server, through Prisma on the database owner role.
-- * Supabase client code on every branch touches only the private_* tables.
-- * Since 13 Nov, anon/authenticated have run no query on these tables apart from one read-only check.
-- * RLS stays on. Policies, the private_* grants and the default privileges for new tables are unchanged.
-- One statement, so it applies atomically. Rollback: 2026-11-17-revoke-data-api-grants.down.sql
REVOKE ALL ON TABLE
  public."ActivityLog", public."AddOn", public."Agent", public."AttritionRule", public."Booking", public."BookingAddOn",
  public."DiscountRule", public."Event", public."Feedback", public."Guest", public."Nudge", public."RFP",
  public."RoomBlock", public."RoomOccupant", public."ScheduleItem", public."Vendor", public."Waitlist",
  public.market_fare_observations, public.serpapi_search_budget_lock, public.serpapi_search_usage
FROM anon, authenticated;
