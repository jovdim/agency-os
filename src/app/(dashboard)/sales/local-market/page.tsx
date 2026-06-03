import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { MapPin, Building2, Mail, Phone, Globe } from "lucide-react";

export default async function LocalMarketPage() {
  const { user } = await requireRole("sales");
  const supabase = await createClient();

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, company_name, contact_person, email, business_email, phone, town, website_url, industry")
    .eq("is_local_market", true)
    .eq("assigned_to", user.id)
    .order("company_name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Local market</h1>
          <p className="text-sm text-muted-foreground">
            Contacts added to the local market ({contacts?.length || 0})
          </p>
        </div>
      </div>

      {!contacts || contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <MapPin className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            No contacts in the local market yet.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Add contacts from the Calling page.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold truncate">{c.company_name}</span>
                  {c.town && (
                    <span className="text-xs text-muted-foreground">• {c.town}</span>
                  )}
                  {c.industry && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{c.industry}</span>
                  )}
                </div>
                {c.contact_person && (
                  <p className="text-sm text-muted-foreground mt-1">{c.contact_person}</p>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">{c.email}</span>
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">{c.phone}</span>
                  </a>
                )}
                {c.website_url && (
                  <a href={c.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <Globe className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
