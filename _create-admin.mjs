import { createClient } from "@supabase/supabase-js";

const url = process.env.SB_URL;
const secret = process.env.SB_SECRET;
const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !secret || !email || !password) {
  console.error("Need SB_URL, SB_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD");
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Create the auth user (or update if it already exists)
let userId;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { role: "super_admin" },
});

if (createErr) {
  if (/already|exist|registered/i.test(createErr.message)) {
    const { data: list } = await admin.auth.admin.listUsers();
    const u = list.users.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) throw createErr;
    userId = u.id;
    await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      app_metadata: { role: "super_admin" },
    });
    console.log("auth user existed, updated:", userId);
  } else {
    throw createErr;
  }
} else {
  userId = created.user.id;
  console.log("auth user created:", userId);
}

// 2. Ensure a profiles row with super_admin role
const { error: upErr } = await admin.from("profiles").upsert(
  { id: userId, role: "super_admin", full_name: "Administrator", is_active: true },
  { onConflict: "id" }
);
if (upErr) throw upErr;
console.log("profile upserted (role=super_admin)");

// 3. Re-assert app_metadata in case a profile trigger rewrote it
await admin.auth.admin.updateUserById(userId, { app_metadata: { role: "super_admin" } });

// 4. Verify both sources agree
const { data: prof } = await admin
  .from("profiles")
  .select("role, is_active")
  .eq("id", userId)
  .single();
const { data: got } = await admin.auth.admin.getUserById(userId);
console.log(`\nVERIFY  profiles.role=${prof?.role}  is_active=${prof?.is_active}  app_metadata.role=${got.user.app_metadata?.role}`);
console.log(`\nLOGIN  ${email}  /  ${password}`);
