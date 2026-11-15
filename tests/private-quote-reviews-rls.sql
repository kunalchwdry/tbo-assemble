\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
\i docs/security/private-quote-reviews.sql
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.private_quote_reviews(title,snapshot) VALUES ('A review','{"schema":"demo"}');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.private_quote_reviews) <> 1 THEN RAISE EXCEPTION 'owner cannot read'; END IF;
 BEGIN INSERT INTO public.private_quote_reviews(owner_id,title,snapshot) VALUES ('22222222-2222-4222-8222-222222222222','forged','{}'); RAISE EXCEPTION 'owner_id tampering accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.private_quote_reviews SET title='forged'; RAISE EXCEPTION 'updates allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.private_quote_reviews(title,snapshot) VALUES ('big',jsonb_build_object('text',repeat('x',50000))); RAISE EXCEPTION 'oversize accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN IF (SELECT count(*) FROM public.private_quote_reviews) <> 0 THEN RAISE EXCEPTION 'cross-owner read'; END IF; DELETE FROM public.private_quote_reviews; IF FOUND THEN RAISE EXCEPTION 'cross-owner delete'; END IF; END $$;
INSERT INTO public.private_quote_reviews(title,snapshot) SELECT 'B review '||g,'{}'::jsonb FROM generate_series(1,100) g;
DO $$ BEGIN BEGIN INSERT INTO public.private_quote_reviews(title,snapshot) VALUES ('over quota','{}'); RAISE EXCEPTION 'quota failed'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM count(*) FROM public.private_quote_reviews; RAISE EXCEPTION 'anonymous read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
DELETE FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111';
DO $$ BEGIN IF EXISTS (SELECT FROM public.private_quote_reviews WHERE owner_id='11111111-1111-4111-8111-111111111111') THEN RAISE EXCEPTION 'cascade failed'; END IF; END $$;
ROLLBACK;
