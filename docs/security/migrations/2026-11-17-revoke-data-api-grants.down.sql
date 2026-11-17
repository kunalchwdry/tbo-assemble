-- Rollback of 2026-11-17-revoke-data-api-grants.up.sql. Restores the previous Data API grants exactly (ALL, which in
-- PostgreSQL 17 includes MAINTAIN). This re-opens the tables to the Data API, behind RLS only, so it needs the same
-- approval as the up step.
GRANT ALL ON TABLE
  public."ActivityLog", public."AddOn", public."Agent", public."AttritionRule", public."Booking", public."BookingAddOn",
  public."DiscountRule", public."Event", public."Feedback", public."Guest", public."Nudge", public."RFP",
  public."RoomBlock", public."RoomOccupant", public."ScheduleItem", public."Vendor", public."Waitlist",
  public.market_fare_observations, public.serpapi_search_budget_lock, public.serpapi_search_usage
TO anon, authenticated;
