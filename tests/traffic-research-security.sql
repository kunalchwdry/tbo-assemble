-- Run only in a dedicated disposable local database after the archive migration.
BEGIN;
DO $$
DECLARE roles text[] := ARRAY['anon','authenticated']; r text;
BEGIN
 FOREACH r IN ARRAY roles LOOP
  IF has_table_privilege(r,'public.traffic_research_snapshots','SELECT') OR has_table_privilege(r,'public.traffic_research_snapshots','INSERT') OR has_table_privilege(r,'public.traffic_research_snapshots','UPDATE') OR has_table_privilege(r,'public.traffic_research_snapshots','DELETE') OR has_table_privilege(r,'public.traffic_research_runs','SELECT') OR has_table_privilege(r,'public.traffic_research_runs','INSERT') THEN RAISE EXCEPTION 'archive privilege leaked to %',r; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.traffic_research_snapshots'::regclass,'public.traffic_research_runs'::regclass) AND NOT relrowsecurity) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
END $$;
INSERT INTO public.traffic_research_snapshots(origin,destination,week_utc,source_sha256,rows_sha256,snapshot) VALUES ('TST','XYZ','2098-01-06',repeat('a',64),repeat('b',64),'[]');
DO $$ BEGIN
 BEGIN INSERT INTO public.traffic_research_snapshots(origin,destination,week_utc,source_sha256,rows_sha256,snapshot) VALUES ('TST','XYZ','2098-01-06',repeat('a',64),repeat('b',64),'[]'); RAISE EXCEPTION 'duplicate permitted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN INSERT INTO public.traffic_research_snapshots(origin,destination,week_utc,source_sha256,rows_sha256,snapshot) VALUES ('TST','XYZ','2098-01-13','bad',repeat('b',64),'[]'); RAISE EXCEPTION 'bad hash permitted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
