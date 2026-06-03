/**
 * Executes the cleanup defined in scripts/delete-test-data.sql via supabase-js.
 * Supabase-js can't run raw SQL transactions, so each step is run in cascade-
 * safe order. Re-running after a partial failure is safe — already-deleted
 * rows simply no-op.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const DOOMED_USER_IDS = [
  "ee69e514-d140-4c95-8c9f-129936c2724d", // testme@gmail.com
  "2913f0de-2cdd-448d-a941-be7f14da34f3", // lorem77098@gmail.com
  "5c4a6883-035c-4707-afb0-62e7dc63b794", // lorem77d098@gmail.com
  "120cc551-017f-4097-af51-26bc976e8a5c", // nexedge77@gmail.com
  "e987b3e4-d0eb-4a1a-af57-1b2d3485b2f2", // test@gmail.com
  "1a349bff-98b9-4d4c-96f3-8b13622e10d6", // test2@gmail.com
  "90ad4945-8945-44b2-a987-caa9d01ac3d1", // noobmody098@gmail.com
];

const DOOMED_PROPOSAL_IDS = [
  "1f482229-c668-44fd-baa3-a36422b8db76", // test-522529
  "33a6fba6-f0cb-4623-8eb0-611be9435bea", // testcompany-mp2wd600
  "6a381bd3-3886-4435-8d68-dee84b20607b", // nexedge77-hskv
];

const DOOMED_EXTRA_SITE_IDS = [
  "6653fade-5b21-4cbd-bd88-7cf3f99d7ea3", // TestCompany owned by erik
];

const DOOMED_CONTACT_IDS = [
  "34766276-b90f-43d9-8f5a-00733ce666e8",
  "92999396-71ff-4c1d-b091-3e79967ca625",
  "94db9cb4-9cd9-4c13-86f2-4d168f6b101c",
  "6982be59-db62-4687-9574-bf3db1636ef5",
  "de25bf61-0ec8-4880-93d5-19941ca34f00",
  "d3c927c2-ace9-418c-a610-5ba8bd22e3e2",
  "d2d393d9-ea4f-4e22-977a-98953b0a8f06",
  "75316b4a-f656-4414-911d-5e86ffb3be3c",
  "14a2635b-6ce3-4673-aaab-0bb25cf0df37",
  "dc56c8d6-beb5-4e89-9f3b-8070cd2678ac",
  "66fce8ef-65f9-4ae2-aa01-9079ad2bd29c",
  "500e57ee-4b0e-4319-96a3-8840b8849bed",
  "141a4832-7914-4d7a-ace8-f6835a7a6adb",
  "4aa74241-274d-4bd7-879d-9554fc4147e3",
  "54464674-ace8-47b7-be90-cf61b7f180cd",
  "bb9c43cb-e270-43f7-b236-ff24993ab606",
  "de9fdf4c-b998-460d-b035-c7245370ba52",
  "18f6df42-d6bc-462e-a07b-25db850fd77c",
  "c3463679-b981-4739-b6bf-29cb38a62cfa",
];

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1) Null-out contacts.client_user_id (no-cascade FK would block user delete)
  console.log("→ Step 1: detach contacts.client_user_id …");
  const { error: e1, count: c1 } = await sb
    .from("contacts")
    .update({ client_user_id: null }, { count: "exact" })
    .in("client_user_id", DOOMED_USER_IDS);
  if (e1) throw new Error(`Step 1 failed: ${e1.message}`);
  console.log(`   detached ${c1 ?? 0} contact(s)`);

  // 2) Delete the 3 standalone test proposals
  console.log("→ Step 2: delete 3 test proposals …");
  const { error: e2, count: c2 } = await sb
    .from("proposals")
    .delete({ count: "exact" })
    .in("id", DOOMED_PROPOSAL_IDS);
  if (e2) throw new Error(`Step 2 failed: ${e2.message}`);
  console.log(`   deleted ${c2 ?? 0} proposal(s)`);

  // 3) Delete the orphan TestCompany site owned by erik@sales.sk
  console.log("→ Step 3: delete orphan TestCompany site …");
  const { error: e3, count: c3 } = await sb
    .from("sites")
    .delete({ count: "exact" })
    .in("id", DOOMED_EXTRA_SITE_IDS);
  if (e3) throw new Error(`Step 3 failed: ${e3.message}`);
  console.log(`   deleted ${c3 ?? 0} site(s)`);

  // 4) Delete the 7 client auth users (cascades to profiles → sites → …)
  console.log("→ Step 4: delete 7 client auth users …");
  let deletedUsers = 0;
  for (const id of DOOMED_USER_IDS) {
    const { error } = await sb.auth.admin.deleteUser(id);
    if (error) {
      if (/not found|does not exist|no rows/i.test(error.message)) {
        console.log(`   ${id} already gone, skipping`);
        continue;
      }
      throw new Error(`Step 4 failed deleting ${id}: ${error.message}`);
    }
    deletedUsers += 1;
  }
  console.log(`   deleted ${deletedUsers} auth user(s)`);

  // 5) Delete the 19 test CRM contacts
  console.log("→ Step 5: delete 19 test contacts …");
  const { error: e5, count: c5 } = await sb
    .from("contacts")
    .delete({ count: "exact" })
    .in("id", DOOMED_CONTACT_IDS);
  if (e5) throw new Error(`Step 5 failed: ${e5.message}`);
  console.log(`   deleted ${c5 ?? 0} contact(s)`);

  // 6) Verification
  console.log("\n→ Verification …");
  const [users, profiles, proposals, sites, contacts] = await Promise.all([
    sb.from("profiles").select("id", { count: "exact", head: true }).in("id", DOOMED_USER_IDS),
    sb.from("profiles").select("id", { count: "exact", head: true }).in("id", DOOMED_USER_IDS),
    sb.from("proposals").select("id", { count: "exact", head: true }).in("id", DOOMED_PROPOSAL_IDS),
    sb.from("sites").select("id", { count: "exact", head: true }).in("id", DOOMED_EXTRA_SITE_IDS),
    sb.from("contacts").select("id", { count: "exact", head: true }).in("id", DOOMED_CONTACT_IDS),
  ]);
  console.table([
    {
      profiles_remaining: profiles.count ?? "?",
      proposals_remaining: proposals.count ?? "?",
      extra_sites_remaining: sites.count ?? "?",
      contacts_remaining: contacts.count ?? "?",
    },
  ]);

  // auth.users check — needs a list call since we can't query by id-in directly
  let authRemaining = 0;
  for (const id of DOOMED_USER_IDS) {
    const { data } = await sb.auth.admin.getUserById(id);
    if (data?.user) authRemaining += 1;
  }
  console.log(`auth.users remaining: ${authRemaining}`);

  if (
    (profiles.count ?? 0) === 0 &&
    (proposals.count ?? 0) === 0 &&
    (sites.count ?? 0) === 0 &&
    (contacts.count ?? 0) === 0 &&
    authRemaining === 0
  ) {
    console.log("\nDone — everything cleaned up.\n");
  } else {
    console.log("\nWARN: some rows still present. Investigate above.\n");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
