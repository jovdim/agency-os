-- When a contact is deleted, also delete its proposals (instead of SET NULL)
ALTER TABLE public.proposals
  DROP CONSTRAINT proposals_contact_id_fkey,
  ADD CONSTRAINT proposals_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
