-- Allow sales to delete their own contacts
CREATE POLICY "Sales delete own contacts"
  ON public.contacts FOR DELETE
  USING (assigned_to = auth.uid());
