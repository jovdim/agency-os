import { requireRole } from "@/lib/auth/guards";
import { NewContactForm } from "./new-contact-form";

export default async function NewContactPage() {
  await requireRole("sales");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">New Contact</h1>
      <NewContactForm />
    </div>
  );
}
