import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";

/**
 * /sales/live-clients/[id] — thin redirect to /sales/proposals/[id].
 *
 * Sales' live-client detail is now the SAME ProposalTimeline + embedded
 * live-client card that tech shows at /tech/proposals/[id] (and super
 * reuses by redirecting into tech's). Sales can't enter /tech routes
 * (middleware), so /sales/proposals/[id] is the sales-side mirror — and
 * this route just bounces there so the standalone card view (and any old
 * bookmarks) land on the unified page. Access scoping + migrated handling
 * live on the target page.
 */
export const dynamic = "force-dynamic";

export default async function SalesLiveClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("sales");
  const { id } = await params;
  redirect(`/sales/proposals/${id}`);
}
