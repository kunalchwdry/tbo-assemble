-- Server-owned dated route observations. Client roles cannot read or write directly.
-- API verifies Supabase identity and scopes every query by owner.
CREATE TABLE IF NOT EXISTS public.route_forecast_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 origin text NOT NULL CHECK (char_length(origin)=3),
 destination text NOT NULL CHECK (char_length(destination)=3),
 captured_at timestamptz NOT NULL DEFAULT now(),
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='array' AND pg_column_size(snapshot)<100000),
 forecast jsonb CHECK (forecast IS NULL OR jsonb_typeof(forecast)='object'),
 model_version text NOT NULL DEFAULT 'india-traffic-v2'
);
CREATE INDEX IF NOT EXISTS route_forecast_evidence_owner ON public.route_forecast_evidence(owner_id,origin,destination,captured_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS route_forecast_evidence_daily ON public.route_forecast_evidence(owner_id,origin,destination,((captured_at AT TIME ZONE 'UTC')::date));
ALTER TABLE public.route_forecast_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_forecast_evidence FROM PUBLIC, anon, authenticated;
