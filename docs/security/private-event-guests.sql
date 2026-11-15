-- Additive private guest list, separate from legacy Guest and Booking tables.
-- Owner and parent identity are database-enforced and cannot be set/changed by clients.
CREATE TABLE public.private_event_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'confirmed', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_guest_owner_event_fk FOREIGN KEY (event_id, owner_id)
    REFERENCES public.private_event_drafts(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX private_guest_owner_event_idx ON public.private_event_guests(owner_id, event_id);
-- Serialize inserts per owner so direct API calls cannot race past the quota.
CREATE FUNCTION public.private_guest_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 4017));
  IF (SELECT count(*) FROM public.private_event_guests WHERE owner_id = NEW.owner_id) >= 1000 THEN
    RAISE EXCEPTION 'Private guest limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.private_guest_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER private_guest_limit BEFORE INSERT ON public.private_event_guests FOR EACH ROW EXECUTE FUNCTION public.private_guest_limit();
ALTER TABLE public.private_event_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_event_guests FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.private_event_guests TO authenticated;
GRANT INSERT (event_id, name, email, phone, status) ON public.private_event_guests TO authenticated;
GRANT UPDATE (name, email, phone, status) ON public.private_event_guests TO authenticated;
CREATE POLICY private_guest_select_own ON public.private_event_guests FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY private_guest_insert_own ON public.private_event_guests FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY private_guest_update_own ON public.private_event_guests FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY private_guest_delete_own ON public.private_event_guests FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));
