/**
 * Inspect auth.users + auth.identities for a given user id.
 * Usage: npx tsx scripts/inspect-auth-identity.ts <user-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("usage: <user-id>");
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data } = await supabase.auth.admin.getUserById(userId);
  if (!data?.user) {
    console.error("user not found");
    process.exit(1);
  }
  console.log("users.email          :", data.user.email);
  console.log("users.email_confirmed:", data.user.email_confirmed_at ?? "—");
  console.log("identities:");
  for (const i of data.user.identities ?? []) {
    console.log("  provider     :", i.provider);
    console.log("  id           :", i.id);
    console.log("  identity_data:", JSON.stringify(i.identity_data));
    console.log("  last_sign_in :", i.last_sign_in_at);
    console.log("  ---");
  }
}
main();
