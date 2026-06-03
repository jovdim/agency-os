-- Fix: Sync role to auth.users.raw_app_meta_data
-- This allows the middleware to read the role via getUser() without a JWT hook.
--
-- Run this in Supabase SQL Editor.

-- 1. Backfill existing users: copy role from profiles → auth.users app_metadata
UPDATE auth.users u
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p.role::text)
FROM public.profiles p
WHERE p.id = u.id;

-- 2. Update handle_new_user trigger to also write role into app_metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'client');

  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  -- Sync role to app_metadata so middleware reads it without extra query
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', v_role::text)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- 3. Add trigger: when profile role changes, update app_metadata too
CREATE OR REPLACE FUNCTION public.sync_role_to_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', NEW.role::text)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_profile_role_to_auth
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_auth();
