import { redirect } from "next/navigation";

/**
 * Settings index — auto-redirects to the first/default sub-page.
 *
 * Visiting `/tech/settings` directly (e.g. via the main sidebar
 * "Settings" link) lands here and bounces straight to the first
 * sub-page. When more settings categories ship, this default may
 * change to a dashboard / overview page; for now AI is the only
 * tenant so going there directly is the right behavior.
 */
export default function TechSettingsIndexPage() {
  redirect("/tech/settings/ai");
}
