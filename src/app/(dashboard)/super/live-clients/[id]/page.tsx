import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";

/**
 * /super/live-clients/[id] — thin redirect to /tech/proposals/[id].
 *
 * Tech merged its live-client management cards (Contact / Site /
 * Payment / Credits / Services) into the proposal timeline page —
 * there's no /tech/live-clients/[id] anymore. To keep super's
 * flow identical to tech's (Peter 2026-05-27), super's detail
 * route bounces to the same proposal page tech uses.
 *
 * Role hierarchy already lets super_admin into /tech routes.
 */
export const dynamic = "force-dynamic";

export default async function SuperLiveClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin");
  const { id } = await params;
  redirect(`/tech/proposals/${id}`);
}
