import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

// Public thank-you page shown after a successful Stripe Checkout for a
// website (the pay endpoint sets this as success_url). No auth — the
// prospect lands here straight from Stripe. The webhook does the real
// work (marks paid, invoices, emails login); this page just reassures
// them and points to the login.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment received",
  robots: { index: false, follow: false },
};

export default async function ProposalPaidPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let companyName: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("proposals")
      .select("company_name")
      .eq("slug", slug)
      .maybeSingle();
    companyName = data?.company_name ?? null;
  } catch {
    // Best-effort personalization — fall back to the generic greeting.
  }

  const loginUrl =
    (process.env.NEXT_PUBLIC_CLIENT_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "") + "/login";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgb(16 185 129)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          Payment received
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Thank you{companyName ? `, ${companyName}` : ""}. Your website is on
          its way to going live. We&rsquo;ve sent an email with your login
          details so you can sign in and manage your site.
        </p>

        <div className="mt-6">
          <Link
            href={loginUrl}
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to your dashboard
          </Link>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Didn&rsquo;t get the email? Check your spam folder, or reply to the
          message we sent you and we&rsquo;ll help.
        </p>
      </div>
    </main>
  );
}
