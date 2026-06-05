import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { MapPin, Building2, Mail, Phone, Globe, Layers } from "lucide-react";

export default async function LocalMarketPage() {
  const { user } = await requireRole("sales");
  const supabase = await createClient();

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, company_name, contact_person, email, business_email, phone, town, website_url, industry")
    .eq("is_local_market", true)
    .eq("assigned_to", user.id)
    .order("company_name");

  const total = contacts?.length || 0;
  // Distinct towns covered — a quick "spread" read alongside the headline count.
  const townCount = new Set(
    (contacts ?? []).map((c) => c.town?.trim()).filter(Boolean),
  ).size;

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Page header — clean title + one-line subtitle on the left. No
          gradient; a plain header is enough for this list view. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sales
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Local market</h1>
          <p className="text-sm text-muted-foreground">
            Contacts you&apos;ve added to your local market list.
          </p>
        </div>
      </div>

      {/* Stat tiles — quiet operational violet chips summarizing the list. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="dash-card block p-5">
          <div className="flex items-center justify-between">
            <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
              <Layers className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums">{total}</p>
          <p className="mt-1 text-sm font-medium">Local contacts</p>
          <p className="text-xs text-muted-foreground">in your market list</p>
        </div>
        <div className="dash-card block p-5">
          <div className="flex items-center justify-between">
            <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
              <MapPin className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums">{townCount}</p>
          <p className="mt-1 text-sm font-medium">Towns covered</p>
          <p className="text-xs text-muted-foreground">distinct locations</p>
        </div>
      </div>

      {!contacts || contacts.length === 0 ? (
        <div className="dash-panel flex flex-col items-center justify-center px-4 py-16 text-center">
          <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
            <MapPin className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">No contacts in the local market yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add contacts from the Calling page.
          </p>
        </div>
      ) : (
        /* Contact list — soft panel with hairline-divided rows. Each row
           keeps the company identity on the left and the quick-action links
           (email / call / site) on the right. */
        <div className="dash-panel overflow-hidden">
          <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 dash-accent" />
              <h2 className="text-xs font-semibold uppercase tracking-wider">
                Contacts
              </h2>
            </div>
            <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
              {total}
            </span>
          </div>
          <ul className="dash-hairline divide-y">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="dash-row flex items-center justify-between gap-4 px-5 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold truncate">{c.company_name}</span>
                    {c.town && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {c.town}
                      </span>
                    )}
                    {c.industry && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {c.industry}
                      </span>
                    )}
                  </div>
                  {c.contact_person && (
                    <p className="mt-1 text-sm text-muted-foreground">{c.contact_person}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">{c.email}</span>
                    </a>
                  )}
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">{c.phone}</span>
                    </a>
                  )}
                  {c.website_url && (
                    <a
                      href={c.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Globe className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
