\set ON_ERROR_STOP on
-- Run only against a dedicated local testing database.
DO $$ BEGIN IF current_database() <> 'tbo_private_guests_test' OR host(inet_server_addr()) <> '127.0.0.1' THEN RAISE EXCEPTION 'Local test database only'; END IF; END $$;
BEGIN;
INSERT INTO auth.users(id) VALUES ('a0000000-0000-4000-8000-000000000001'),('b0000000-0000-4000-8000-000000000002');
INSERT INTO public.private_event_drafts(id,owner_id,title,starts_on,ends_on) VALUES ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','A event','2027-01-01','2027-01-02'), ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','B event','2027-01-01','2027-01-02');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
INSERT INTO public.private_event_guests(event_id,name,email,phone,status) VALUES ('a1000000-0000-4000-8000-000000000001','A guest','a@example.test','+91 12345','invited');
UPDATE public.private_event_guests SET status='confirmed' WHERE name='A guest';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.private_event_guests WHERE status='confirmed') <> 1 THEN RAISE EXCEPTION 'owner read/write failed'; END IF;
 BEGIN INSERT INTO public.private_event_guests(event_id,name) VALUES ('b1000000-0000-4000-8000-000000000002','forged'); RAISE EXCEPTION 'cross-owner guest insert succeeded'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO public.private_event_guests(owner_id,event_id,name) VALUES ('b0000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','forged'); RAISE EXCEPTION 'owner spoof succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.private_event_guests SET event_id='b1000000-0000-4000-8000-000000000002'; RAISE EXCEPTION 'guest reparent succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.private_event_guests SET owner_id='b0000000-0000-4000-8000-000000000002'; RAISE EXCEPTION 'owner change succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.private_event_guests SET status='bad'; RAISE EXCEPTION 'bad status succeeded'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE n integer; BEGIN
 IF (SELECT count(*) FROM public.private_event_guests)<>0 THEN RAISE EXCEPTION 'cross-user read'; END IF;
 UPDATE public.private_event_guests SET name='forged' WHERE event_id='a1000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross-user update'; END IF;
 DELETE FROM public.private_event_guests WHERE event_id='a1000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross-user delete'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
INSERT INTO public.private_event_guests(event_id,name) SELECT 'a1000000-0000-4000-8000-000000000001','Guest '||i FROM generate_series(1,999) i;
DO $$ BEGIN BEGIN INSERT INTO public.private_event_guests(event_id,name) VALUES ('a1000000-0000-4000-8000-000000000001','over quota'); RAISE EXCEPTION 'quota bypassed'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;
DELETE FROM public.private_event_drafts WHERE id='a1000000-0000-4000-8000-000000000001';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.private_event_guests) THEN RAISE EXCEPTION 'event cascade failed'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM * FROM public.private_event_guests; RAISE EXCEPTION 'anonymous read succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
ROLLBACK;
