-- Global public-data research archive. Only the server database owner accesses
-- these tables; neither Supabase browser role can read or write them.
-- This is bounded, not immutable or a certified timestamp service.
CREATE TABLE IF NOT EXISTS public.traffic_research_snapshots (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 origin text NOT NULL CHECK (origin ~ '^[A-Z]{3}$'),
 destination text NOT NULL CHECK (destination ~ '^[A-Z]{3}$'),
 captured_at timestamptz NOT NULL DEFAULT now(),
 week_utc date NOT NULL,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
 rows_sha256 text NOT NULL CHECK (rows_sha256 ~ '^[0-9a-f]{64}$'),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='array' AND pg_column_size(snapshot)<100000),
 forecast jsonb CHECK (forecast IS NULL OR jsonb_typeof(forecast)='object'),
 model_version text NOT NULL DEFAULT 'india-traffic-v4',
 UNIQUE (origin,destination,week_utc)
);
CREATE INDEX IF NOT EXISTS traffic_research_route_captured ON public.traffic_research_snapshots(origin,destination,captured_at);
CREATE TABLE IF NOT EXISTS public.traffic_research_runs (
 week_utc date PRIMARY KEY,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL CHECK (status IN ('running','success','partial','failed')),
 saved integer NOT NULL DEFAULT 0 CHECK (saved BETWEEN 0 AND 6),
 skipped integer NOT NULL DEFAULT 0 CHECK (skipped BETWEEN 0 AND 6),
 failed integer NOT NULL DEFAULT 0 CHECK (failed BETWEEN 0 AND 6)
);
ALTER TABLE public.traffic_research_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_research_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.traffic_research_snapshots,public.traffic_research_runs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.traffic_research_snapshots_id_seq FROM PUBLIC,anon,authenticated;
