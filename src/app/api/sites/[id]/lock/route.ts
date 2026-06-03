/**
 * Site edit-lock heartbeat + release.
 *
 *   POST   /api/sites/[id]/lock — acquire OR refresh the lock
 *   DELETE /api/sites/[id]/lock — release the lock if we hold it
 *
 * The composer's *initial* lock check happens server-side in the page
 * render (see acquireOrCheckLock in lib/composer/site-lock). This route
 * is what the client tab uses to keep the lock alive while it's open
 * and to give it back when the tab closes.
 *
 * Auth: any authenticated user can call. The RPC enforces the actual
 * "do you currently hold the lock" check; the route just supplies user
 * id + role from the session.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { acquireOrCheckLock, releaseLock } from "@/lib/composer/site-lock";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const role = (user.app_metadata?.role as string | undefined) ?? "unknown";
  const admin = createAdminClient();

  try {
    const result = await acquireOrCheckLock(admin, id, user.id, role);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lock acquire failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  await releaseLock(admin, id, user.id);
  return NextResponse.json({ ok: true });
}
