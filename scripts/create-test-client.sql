-- ────────────────────────────────────────────────────────────────────────
-- ONE-SHOT TEST DATA: client account + non-legacy composer site they own.
-- Use to quickly test Phase C without having to send a real proposal.
--
-- BEFORE running:
--   1. Change TEST_EMAIL below to whatever email you want to log in with.
--      (Use a real email if you want to test the password-reset flow,
--       otherwise any unique fake address works.)
--   2. Change TEST_PASSWORD if you want a different password.
--      Default below: 'TestClient123!'
--
-- AFTER running:
--   - The script prints the email + password + site URL at the end.
--   - Log out from super admin → log in with those creds at /login.
--   - You'll land on /client → click "Sites" → click the test site →
--     click "Edit" → land on the new locked-down composer.
--
-- TO CLEAN UP later: delete from auth.users where email = '<TEST_EMAIL>';
--   (cascades to profile + site + everything via FK constraints.)
-- ────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  TEST_EMAIL  CONSTANT TEXT := 'phase-c-test@example.com';
  TEST_PASSWORD CONSTANT TEXT := 'TestClient123!';
  TEST_NAME   CONSTANT TEXT := 'Phase C Test Client';
  SITE_NAME   CONSTANT TEXT := 'Phase C Test Site';

  v_user_id   UUID;
  v_site_id   UUID;
  v_slug      TEXT;
BEGIN
  -- ── 1. Create the auth user via Supabase's auth schema ────────────────
  -- We insert directly because it's the only way without going through the
  -- admin API. The encrypted_password uses bcrypt — Supabase's gen_salt()
  -- + crypt() handles it.
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    aud,
    role,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    TEST_EMAIL,
    crypt(TEST_PASSWORD, gen_salt('bf')),
    NOW(),                                 -- email auto-confirmed (no email click)
    jsonb_build_object('role', 'client', 'provider', 'email'),
    jsonb_build_object('full_name', TEST_NAME),
    'authenticated',
    'authenticated',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_user_id;

  -- ── 2. Profile row (the trigger SHOULD do this, but belt-and-suspenders) ─
  INSERT INTO profiles (id, email, full_name, role, is_active, created_at)
  VALUES (v_user_id, TEST_EMAIL, TEST_NAME, 'client', true, NOW())
  ON CONFLICT (id) DO UPDATE
    SET role = 'client', is_active = true;

  -- ── 3. Site owned by this client, non-legacy so it routes to the new
  --       composer. Composition starts empty — the client will land on a
  --       blank composer. (For a more realistic test, run "Generate full
  --       site" from the tech admin first, then move owner_id below.)
  v_slug := 'phase-c-test-' || substr(md5(random()::text), 1, 6);
  INSERT INTO sites (
    id, name, slug, owner_id, is_legacy, status, is_paid, composition, created_at
  ) VALUES (
    gen_random_uuid(),
    SITE_NAME,
    v_slug,
    v_user_id,
    false,                                  -- ← critical: composer-based, not GitHub
    'review',
    true,
    jsonb_build_object(
      'pages', jsonb_build_array(
        jsonb_build_object('path', 'index.html', 'label', 'Domov', 'sections', '[]'::jsonb)
      )
    ),
    NOW()
  )
  RETURNING id INTO v_site_id;

  -- ── 4. Print credentials so you can copy-paste them ─────────────────────
  RAISE NOTICE '─────────────────────────────────────────────────────────';
  RAISE NOTICE 'TEST CLIENT CREATED.';
  RAISE NOTICE '  Email:    %', TEST_EMAIL;
  RAISE NOTICE '  Password: %', TEST_PASSWORD;
  RAISE NOTICE '  Site id:  %', v_site_id;
  RAISE NOTICE '  Edit URL: /client/sites/%/edit', v_site_id;
  RAISE NOTICE '─────────────────────────────────────────────────────────';
END $$;
