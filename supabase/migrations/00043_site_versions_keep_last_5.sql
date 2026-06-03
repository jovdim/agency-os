-- Cap site_versions history at 5 rows per site.
--
-- Approach: an AFTER INSERT trigger that deletes any rows beyond the
-- latest 5 for the same site_id. Cheap (one DELETE per insert), atomic
-- (runs in the same transaction as the publish), and works regardless
-- of which API path inserts the row.

CREATE OR REPLACE FUNCTION public.cap_site_versions_history()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.site_versions
  WHERE site_id = NEW.site_id
    AND id NOT IN (
      SELECT id FROM public.site_versions
      WHERE site_id = NEW.site_id
      ORDER BY created_at DESC
      LIMIT 5
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS site_versions_cap_history ON public.site_versions;

CREATE TRIGGER site_versions_cap_history
  AFTER INSERT ON public.site_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.cap_site_versions_history();

COMMENT ON FUNCTION public.cap_site_versions_history IS
  'Keeps only the 5 most recent versions per site. Older rows are deleted on each new insert.';
