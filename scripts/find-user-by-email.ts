/**
 * Find auth users matching an email substring.
 * Usage: npx tsx scripts/find-user-by-email.ts <substring>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const q = (process.argv[2] || "").toLowerCase();
  if (!q) {
    console.error("usage: <substring>");
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let page = 1;
  const matches: Array<{
    id: string;
    email: string | undefined;
    confirmed: string | null;
    last_sign_in: string | null;
  }> = [];
  // paginate through all users
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      console.error("list failed:", error.message);
      process.exit(1);
    }
    const users = data?.users ?? [];
    if (users.length === 0) break;
    for (const u of users) {
      if ((u.email ?? "").toLowerCase().includes(q)) {
        matches.push({
          id: u.id,
          email: u.email ?? undefined,
          confirmed: u.email_confirmed_at ?? null,
          last_sign_in: u.last_sign_in_at ?? null,
        });
      }
    }
    if (users.length < 200) break;
    page++;
  }

  if (matches.length === 0) {
    console.log("no matches");
    return;
  }
  for (const m of matches) {
    console.log(`${m.id}  ${m.email}`);
    console.log(`  confirmed_at=${m.confirmed}  last_sign_in=${m.last_sign_in}`);
  }
}
main();
