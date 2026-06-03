-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE TEST DATA  —  run in Supabase SQL editor
--
-- DRY-RUN BY DEFAULT: the block ends with ROLLBACK so nothing is committed.
-- 1) Paste this into the SQL editor and Run it once. You should see no errors
--    and the verification SELECTs at the bottom should all show 0 rows.
-- 2) If happy: change the last line from ROLLBACK to COMMIT and re-run.
--
-- What's being deleted:
--   • 7 client auth users (cascades to: profile → sites → sections,
--     change_requests, credit_balances/transactions, payments, invoices,
--     services, contact_form_submissions)
--   • 3 standalone proposals (cascades to: messages, reminders, deployments,
--     email_logs)
--   • 1 standalone site owned by a REAL salesperson (TestCompany on erik@sales.sk)
--   • 19 contacts (cascades to: call_logs, invoice_requests)
--
-- Test users to delete:
--   testme@gmail.com / lorem77098@gmail.com / lorem77d098@gmail.com
--   nexedge77@gmail.com / test@gmail.com / test2@gmail.com / noobmody098@gmail.com
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Detach contacts.client_user_id (NO ACTION FK would block the delete) ──
UPDATE contacts SET client_user_id = NULL
WHERE client_user_id IN (
  'ee69e514-d140-4c95-8c9f-129936c2724d',  -- testme@gmail.com
  '2913f0de-2cdd-448d-a941-be7f14da34f3',  -- lorem77098@gmail.com
  '5c4a6883-035c-4707-afb0-62e7dc63b794',  -- lorem77d098@gmail.com
  '120cc551-017f-4097-af51-26bc976e8a5c',  -- nexedge77@gmail.com
  'e987b3e4-d0eb-4a1a-af57-1b2d3485b2f2',  -- test@gmail.com
  '1a349bff-98b9-4d4c-96f3-8b13622e10d6',  -- test2@gmail.com
  '90ad4945-8945-44b2-a987-caa9d01ac3d1'   -- noobmody098@gmail.com
);

-- ── 2) Delete the 3 standalone test proposals (cascades through messages,
--        reminders, deployments, email_logs; nulls sites.proposal_id and
--        payments.proposal_id refs) ──
DELETE FROM proposals WHERE id IN (
  '1f482229-c668-44fd-baa3-a36422b8db76',  -- test-522529
  '33a6fba6-f0cb-4623-8eb0-611be9435bea',  -- testcompany-mp2wd600
  '6a381bd3-3886-4435-8d68-dee84b20607b'   -- nexedge77-hskv
);

-- ── 3) Delete the orphan TestCompany site owned by Erik (real salesperson) ──
DELETE FROM sites WHERE id = '6653fade-5b21-4cbd-bd88-7cf3f99d7ea3';

-- ── 4) Delete the 7 client auth users — cascades to profiles → sites → … ──
DELETE FROM auth.users WHERE id IN (
  'ee69e514-d140-4c95-8c9f-129936c2724d',
  '2913f0de-2cdd-448d-a941-be7f14da34f3',
  '5c4a6883-035c-4707-afb0-62e7dc63b794',
  '120cc551-017f-4097-af51-26bc976e8a5c',
  'e987b3e4-d0eb-4a1a-af57-1b2d3485b2f2',
  '1a349bff-98b9-4d4c-96f3-8b13622e10d6',
  '90ad4945-8945-44b2-a987-caa9d01ac3d1'
);

-- ── 5) Delete the 19 test CRM contacts ──
DELETE FROM contacts WHERE id IN (
  '34766276-b90f-43d9-8f5a-00733ce666e8',  -- test
  '92999396-71ff-4c1d-b091-3e79967ca625',  -- test
  '94db9cb4-9cd9-4c13-86f2-4d168f6b101c',  -- TestCompany
  '6982be59-db62-4687-9574-bf3db1636ef5',  -- nexedge77 / ipsum dolor
  'de25bf61-0ec8-4880-93d5-19941ca34f00',  -- Xxx
  'd3c927c2-ace9-418c-a610-5ba8bd22e3e2',  -- Xxx
  'd2d393d9-ea4f-4e22-977a-98953b0a8f06',  -- test
  '75316b4a-f656-4414-911d-5e86ffb3be3c',  -- lorem
  '14a2635b-6ce3-4673-aaab-0bb25cf0df37',  -- nothing / test@tes.
  'dc56c8d6-beb5-4e89-9f3b-8070cd2678ac',  -- Sex Shop Test
  '66fce8ef-65f9-4ae2-aa01-9079ad2bd29c',  -- Su100 Test
  '500e57ee-4b0e-4319-96a3-8840b8849bed',  -- Montaz nabytku (fake email)
  '141a4832-7914-4d7a-ace8-f6835a7a6adb',  -- Test Company s.r.o.
  '4aa74241-274d-4bd7-879d-9554fc4147e3',  -- Test Company s.r.o.
  '54464674-ace8-47b7-be90-cf61b7f180cd',  -- MÚZA n.o. (fake email)
  'bb9c43cb-e270-43f7-b236-ff24993ab606',  -- lorem
  'de9fdf4c-b998-460d-b035-c7245370ba52',  -- test test
  '18f6df42-d6bc-462e-a07b-25db850fd77c',  -- loremtest
  'c3463679-b981-4739-b6bf-29cb38a62cfa'   -- Test Company / Peter Sustak
);

-- ── Verification (all should return 0) ──
SELECT 'auth_users_remaining' AS what, COUNT(*) AS n FROM auth.users WHERE id IN (
  'ee69e514-d140-4c95-8c9f-129936c2724d','2913f0de-2cdd-448d-a941-be7f14da34f3',
  '5c4a6883-035c-4707-afb0-62e7dc63b794','120cc551-017f-4097-af51-26bc976e8a5c',
  'e987b3e4-d0eb-4a1a-af57-1b2d3485b2f2','1a349bff-98b9-4d4c-96f3-8b13622e10d6',
  '90ad4945-8945-44b2-a987-caa9d01ac3d1'
)
UNION ALL
SELECT 'profiles_remaining', COUNT(*) FROM profiles WHERE id IN (
  'ee69e514-d140-4c95-8c9f-129936c2724d','2913f0de-2cdd-448d-a941-be7f14da34f3',
  '5c4a6883-035c-4707-afb0-62e7dc63b794','120cc551-017f-4097-af51-26bc976e8a5c',
  'e987b3e4-d0eb-4a1a-af57-1b2d3485b2f2','1a349bff-98b9-4d4c-96f3-8b13622e10d6',
  '90ad4945-8945-44b2-a987-caa9d01ac3d1'
)
UNION ALL
SELECT 'proposals_remaining', COUNT(*) FROM proposals WHERE id IN (
  '1f482229-c668-44fd-baa3-a36422b8db76','33a6fba6-f0cb-4623-8eb0-611be9435bea',
  '6a381bd3-3886-4435-8d68-dee84b20607b'
)
UNION ALL
SELECT 'extra_site_remaining', COUNT(*) FROM sites WHERE id = '6653fade-5b21-4cbd-bd88-7cf3f99d7ea3'
UNION ALL
SELECT 'contacts_remaining', COUNT(*) FROM contacts WHERE id IN (
  '34766276-b90f-43d9-8f5a-00733ce666e8','92999396-71ff-4c1d-b091-3e79967ca625',
  '94db9cb4-9cd9-4c13-86f2-4d168f6b101c','6982be59-db62-4687-9574-bf3db1636ef5',
  'de25bf61-0ec8-4880-93d5-19941ca34f00','d3c927c2-ace9-418c-a610-5ba8bd22e3e2',
  'd2d393d9-ea4f-4e22-977a-98953b0a8f06','75316b4a-f656-4414-911d-5e86ffb3be3c',
  '14a2635b-6ce3-4673-aaab-0bb25cf0df37','dc56c8d6-beb5-4e89-9f3b-8070cd2678ac',
  '66fce8ef-65f9-4ae2-aa01-9079ad2bd29c','500e57ee-4b0e-4319-96a3-8840b8849bed',
  '141a4832-7914-4d7a-ace8-f6835a7a6adb','4aa74241-274d-4bd7-879d-9554fc4147e3',
  '54464674-ace8-47b7-be90-cf61b7f180cd','bb9c43cb-e270-43f7-b236-ff24993ab606',
  'de9fdf4c-b998-460d-b035-c7245370ba52','18f6df42-d6bc-462e-a07b-25db850fd77c',
  'c3463679-b981-4739-b6bf-29cb38a62cfa'
);

-- ── FINAL STEP ──
-- DRY-RUN (default): nothing committed
ROLLBACK;
-- TO APPLY: comment the line above and uncomment the line below, then re-run
-- COMMIT;
