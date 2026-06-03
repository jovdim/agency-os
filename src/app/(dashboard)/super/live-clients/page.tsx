import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";

/**
 * /super/live-clients — thin redirect to the tech-side list. Super
 * previously had its own implementation that drifted from the tech
 * UI; Peter 2026-05-27 asked for an identical experience. Same
 * approach as /super/proposals and /super/production redirects.
 *
 * Role hierarchy already lets super_admin into /tech routes.
 *
 * Tech merged its live-client management cards into the proposal
 * timeline (clicking a row goes to /tech/proposals/[id]), so the
 * /super/live-clients/[id] detail page also redirects to keep the
 * super flow consistent with tech's.
 */
export const dynamic = "force-dynamic";

export default async function SuperLiveClientsPage() {
  await requireRole("super_admin");
  redirect("/tech/live-clients");
}
