-- Additive, owner-scoped quote review snapshots. No approval or booking implied.
CREATE TABLE public.private_quote_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 48000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX private_quote_reviews_owner_created_idx ON public.private_quote_reviews (owner_id, created_at DESC);
CREATE FUNCTION public.private_quote_review_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 4021));
 IF (SELECT count(*) FROM public.private_quote_reviews WHERE owner_id = NEW.owner_id) >= 100 THEN
  RAISE EXCEPTION 'Private quote review limit reached' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.private_quote_review_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER private_quote_review_limit BEFORE INSERT ON public.private_quote_reviews FOR EACH ROW EXECUTE FUNCTION public.private_quote_review_limit();
ALTER TABLE public.private_quote_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_quote_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.private_quote_reviews TO authenticated;
GRANT INSERT (title, snapshot) ON public.private_quote_reviews TO authenticated;
CREATE POLICY quote_review_select_own ON public.private_quote_reviews FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY quote_review_insert_own ON public.private_quote_reviews FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY quote_review_delete_own ON public.private_quote_reviews FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));
