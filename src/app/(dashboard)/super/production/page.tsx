import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";

/**
 * /super/production — thin redirect to the tech-side Published
 * Websites page. Super previously had its own implementation
 * (production-client.tsx, still on disk as unreferenced code)
 * that drifted from the tech UI; Peter 2026-05-27 asked for an
 * identical experience between super + tech here, including the
 * Composer button so super can edit + publish like tech does.
 *
 * Role hierarchy already lets super_admin into /tech routes
 * (see ROUTE_ROLES["/tech"] in lib/auth/roles.ts), so the
 * redirect is enough. Same approach used for the proposal
 * detail + composer redirects added the same day.
 *
 * Dead code: production-client.tsx in this folder. Safe to
 * delete in a follow-up cleanup; left in place for now to
 * minimize risk of accidentally breaking an unrelated import.
 */
export const dynamic = "force-dynamic";

export default async function SuperProductionPage() {
  await requireRole("super_admin");
  redirect("/tech/production");
}
