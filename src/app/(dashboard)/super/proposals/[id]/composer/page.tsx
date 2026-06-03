import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";

/**
 * /super/proposals/[id]/composer — thin redirect to the tech-side
 * composer. Mirrors the detail page redirect alongside it. Super
 * admin already has /tech access via the role hierarchy, so this
 * is just a URL-namespace alias (Peter 2026-05-23 urgent fix —
 * super was missing both the detail and composer entry points
 * that sales + tech already had).
 */
export const dynamic = "force-dynamic";

export default async function SuperProposalComposerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin");
  const { id } = await params;
  redirect(`/tech/proposals/${id}/composer`);
}
