-- ─────────────────────────────────────────────────────────────────────────────
-- TEST DATA AUDIT (read-only)
-- Run in Supabase SQL editor. Surfaces likely test rows across:
--   contacts, proposals, sites, client profiles
-- Nothing is deleted. Copy back the IDs you want gone.
--
-- Pattern criteria (case-insensitive, word-boundary where useful):
--   • text fields containing: test, demo, asdf, qwer, foo, bar, lorem,
--     ipsum, sample, dummy, fake, placeholder, xxx, aaa, zzz
--   • emails on throwaway domains: @test. @example. @demo. @asdf. @foo. @localhost
--   • emails with local-part starting with test/demo/asdf/qwer/fake/dummy
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Sanity counts
SELECT
  (SELECT COUNT(*) FROM contacts)                       AS contacts_total,
  (SELECT COUNT(*) FROM proposals)                      AS proposals_total,
  (SELECT COUNT(*) FROM sites)                          AS sites_total,
  (SELECT COUNT(*) FROM profiles WHERE role = 'client') AS client_profiles_total;

-- 2) Suspect CONTACTS (raw CRM leads)
SELECT
  c.id,
  c.company_name,
  c.contact_person,
  c.email,
  c.phone,
  c.industry,
  c.status,
  c.source,
  c.created_at
FROM contacts c
WHERE
     c.company_name   ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
  OR c.contact_person ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
  OR c.email          ~* '@(test|example|demo|asdf|foo|localhost)\.'
  OR c.email          ~* '^(test|demo|asdf|qwer|fake|dummy)[^@]*@'
ORDER BY c.created_at DESC;

-- 3) Suspect PROPOSALS (joined to their source contact)
SELECT
  p.id,
  p.slug,
  p.company_name,
  p.status,
  p.price,
  p.created_at,
  c.contact_person,
  c.email          AS contact_email
FROM proposals p
LEFT JOIN contacts c ON c.id = p.contact_id
WHERE
     p.company_name ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
  OR p.slug         ~* '(test|demo|asdf|qwer|fake|dummy)'
  OR c.company_name ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
  OR c.email        ~* '@(test|example|demo|asdf|foo|localhost)\.'
ORDER BY p.created_at DESC;

-- 4) Suspect SITES (joined to owner profile + auth email)
SELECT
  s.id,
  s.name,
  s.slug,
  s.site_url,
  s.domain,
  s.status,
  s.created_at,
  pr.full_name    AS owner_name,
  pr.company_name AS owner_company,
  au.email        AS owner_email
FROM sites s
LEFT JOIN profiles pr  ON pr.id = s.owner_id
LEFT JOIN auth.users au ON au.id = s.owner_id
WHERE
     s.name           ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
  OR s.slug           ~* '(test|demo|asdf|qwer|fake|dummy|xxx|aaa|zzz)'
  OR pr.company_name  ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
  OR au.email         ~* '@(test|example|demo|asdf|foo|localhost)\.'
  OR au.email         ~* '^(test|demo|asdf|qwer|fake|dummy)[^@]*@'
ORDER BY s.created_at DESC;

-- 5) Suspect CLIENT PROFILES (auth users, role = client)
SELECT
  pr.id,
  pr.full_name,
  pr.company_name,
  au.email,
  pr.phone,
  pr.is_active,
  pr.created_at,
  (SELECT COUNT(*) FROM sites s     WHERE s.owner_id      = pr.id) AS site_count,
  (SELECT COUNT(*) FROM proposals p WHERE p.sales_person_id = pr.id) AS proposal_count
FROM profiles pr
LEFT JOIN auth.users au ON au.id = pr.id
WHERE pr.role = 'client'
  AND (
       pr.full_name    ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
    OR pr.company_name ~* '\m(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\M'
    OR au.email        ~* '@(test|example|demo|asdf|foo|localhost)\.'
    OR au.email        ~* '^(test|demo|asdf|qwer|fake|dummy)[^@]*@'
  )
ORDER BY pr.created_at DESC;
