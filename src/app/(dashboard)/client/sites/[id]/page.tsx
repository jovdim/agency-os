import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ClientSiteDetailPage() {
  // Site detail is now shown directly on /client dashboard
  redirect("/client");
}
