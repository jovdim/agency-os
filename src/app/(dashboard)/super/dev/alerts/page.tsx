import { requireRole } from "@/lib/auth/guards";
import { AlertsDemoClient } from "./alerts-demo-client";

export const dynamic = "force-dynamic";

export default async function AlertsDemoPage() {
  await requireRole("super_admin");
  return <AlertsDemoClient />;
}
