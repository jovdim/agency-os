import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/seed/reset — Reset all data in the database.
 * Super admin only. Requires { confirm: "DELETE_ALL_DATA" } in body.
 *
 * Truncates all tables in FK-safe order and clears storage buckets.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (role !== "super_admin") {
    return NextResponse.json(
      { error: "Super admin access required" },
      { status: 403 },
    );
  }

  const body = await req.json();
  if (body.confirm !== "DELETE_ALL_DATA") {
    return NextResponse.json(
      { error: 'Send { confirm: "DELETE_ALL_DATA" } to proceed' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const results: Array<{ table: string; status: string; error?: string }> = [];

  // Delete in FK-safe order (children first, parents last)
  const tablesToClear = [
    "audit_log",
    "commissions",
    "credit_transactions",
    "invoices",
    "payments",
    "credit_balances",
    "change_requests",
    "sections",
    "deployments",
    "services",
    "sites",
    "proposals",
    "call_logs",
    "contacts",
    "templates",
    // profiles last — but skip the current super admin user
  ];

  for (const table of tablesToClear) {
    const { error } = await admin.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    results.push({
      table,
      status: error ? "error" : "cleared",
      error: error?.message,
    });
  }

  // Clear profiles except the current user
  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .neq("id", user.id);
  results.push({
    table: "profiles (except you)",
    status: profileError ? "error" : "cleared",
    error: profileError?.message,
  });

  // Clear storage buckets
  const buckets = ["templates", "proposals"];
  for (const bucket of buckets) {
    try {
      const { data: files } = await admin.storage.from(bucket).list("", {
        limit: 1000,
      });

      if (files && files.length > 0) {
        // List all files recursively
        const allPaths = await listAllFiles(admin, bucket, "");
        if (allPaths.length > 0) {
          const { error: delError } = await admin.storage
            .from(bucket)
            .remove(allPaths);
          results.push({
            table: `storage:${bucket}`,
            status: delError ? "error" : `cleared ${allPaths.length} files`,
            error: delError?.message,
          });
        } else {
          results.push({
            table: `storage:${bucket}`,
            status: "empty",
          });
        }
      } else {
        results.push({
          table: `storage:${bucket}`,
          status: "empty",
        });
      }
    } catch (err) {
      results.push({
        table: `storage:${bucket}`,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    message: "Database reset complete",
    results,
  });
}

/**
 * Recursively list all file paths in a storage bucket.
 */
async function listAllFiles(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];

  const { data: items } = await admin.storage.from(bucket).list(prefix, {
    limit: 1000,
  });

  for (const item of items || []) {
    const fullPath = prefix ? `${prefix}/${item.name}` : item.name;

    if (item.id) {
      // It's a file
      paths.push(fullPath);
    } else {
      // It's a folder — recurse
      const subPaths = await listAllFiles(admin, bucket, fullPath);
      paths.push(...subPaths);
    }
  }

  return paths;
}
