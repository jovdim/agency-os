import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";

/**
 * /super/proposals/[id] — thin redirect to the tech-side proposal
 * detail (timeline + actions). Super admin previously had no detail
 * page of their own; the only entry point from /super/proposals was
 * a dead link (Peter 2026-05-23 urgent fix).
 *
 * The role hierarchy already lets super_admin in via /tech URLs
 * (see ROUTE_ROLES["/tech"] in lib/auth/roles.ts), so we just bounce
 * over. Same redirect pattern is applied to the composer below.
 *
 * A future iteration could give super their own /super-native shell
 * with super-specific chrome — for now the tech UI works for both.
 */
export const dynamic = "force-dynamic";

export default async function SuperProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Role guard so a non-super hitting this URL doesn't silently
  // bounce into /tech (which they might also lose access to).
  await requireRole("super_admin");
  const { id } = await params;
  redirect(`/tech/proposals/${id}`);
}
