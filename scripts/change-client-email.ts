/**
 * One-shot: change an auth user's login email + keep it confirmed.
 *
 * Usage:
 *   npx tsx scripts/change-client-email.ts <user-id> <new-email>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const userId = process.argv[2];
  const newEmail = process.argv[3];
  if (!userId || !newEmail) {
    console.error(
      "usage: npx tsx scripts/change-client-email.ts <user-id> <new-email>",
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: before } = await supabase.auth.admin.getUserById(userId);
  if (!before?.user) {
    console.error("user not found:", userId);
    process.exit(1);
  }
  console.log("BEFORE:");
  console.log("  email              :", before.user.email);
  console.log("  email_confirmed_at :", before.user.email_confirmed_at ?? "—");

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    email: newEmail,
    email_confirm: true, // mark the NEW email as confirmed in one shot
  });
  if (error) {
    console.error("update failed:", error.message);
    process.exit(1);
  }

  const { data: after } = await supabase.auth.admin.getUserById(userId);
  console.log("AFTER:");
  console.log("  email              :", after?.user?.email);
  console.log("  email_confirmed_at :", after?.user?.email_confirmed_at ?? "—");
  console.log("\n✓ Login email changed and confirmed.");
}

main();
