"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MagnifyingGlass as Search, Archive, TrayArrowUp as ArchiveRestore, Trash as Trash2, FileText } from "@phosphor-icons/react/ssr";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface ArchivedContact {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  town: string | null;
  website_url: string | null;
  status: string;
  updated_at: string;
  created_at: string;
}

export function ArchiveClient({
  contacts: initialContacts,
}: {
  contacts: ArchivedContact[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const filtered = initialContacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.company_name.toLowerCase().includes(q) ||
      (c.contact_person ?? "").toLowerCase().includes(q) ||
      (c.industry ?? "").toLowerCase().includes(q) ||
      (c.town ?? "").toLowerCase().includes(q)
    );
  });

  async function handleRestore(contactId: string) {
    setActionLoading(contactId);
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({ status: "new" })
      .eq("id", contactId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Contact restored");
      startTransition(() => router.refresh());
    }
    setActionLoading(null);
  }

  async function handleDelete(contactId: string, companyName: string) {
    if (!confirm(`Permanently delete "${companyName}"? This cannot be undone.`)) {
      return;
    }
    setActionLoading(contactId);
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", contactId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Contact deleted");
      startTransition(() => router.refresh());
    }
    setActionLoading(null);
  }

  return (
    <div className="dash-root max-w-6xl space-y-6">
      {/* Clean page header — icon chip + eyebrow + title + one-line count.
          No hero gradient on this operational list; a quiet violet chip
          carries the identity instead. */}
      <header className="flex items-center gap-3">
        <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <Archive className="h-5 w-5" />
        </span>
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sales pipeline
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Archive</h1>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{initialContacts.length}</span> archived
            contact{initialContacts.length !== 1 ? "s" : ""}
          </p>
        </div>
      </header>

      {/* Search */}
      {initialContacts.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search company, contact, industry, town..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="dash-panel dash-hairline flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
            <FileText className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">
            {search ? "No matches" : "No archived contacts"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {search
              ? "Nothing matches your current search."
              : "Archived contacts will show up here."}
          </p>
        </div>
      ) : (
        <div className="dash-panel dash-hairline overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="dash-subhead dash-hairline border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-4 text-right font-semibold w-8">#</th>
                  <th className="py-2.5 px-4 text-left font-semibold min-w-44">Company</th>
                  <th className="py-2.5 px-4 text-left font-semibold min-w-28">Contact</th>
                  <th className="py-2.5 px-4 text-left font-semibold min-w-28">Industry</th>
                  <th className="py-2.5 px-4 text-left font-semibold min-w-24">Town</th>
                  <th className="py-2.5 px-4 text-right font-semibold min-w-28">Archived</th>
                  <th className="py-2.5 px-4 text-center font-semibold w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="dash-hairline divide-y">
                {filtered.map((c, idx) => (
                  <tr
                    key={c.id}
                    data-interactive="true"
                    className="dash-row cursor-pointer"
                    onClick={() => router.push(`/sales/contacts/${c.id}`)}
                  >
                    <td className="py-3 px-4 text-right text-muted-foreground tabular-nums text-xs">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold transition-colors hover:text-(--dash-accent) truncate block max-w-44">
                        {c.company_name}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground truncate max-w-28">
                      {c.contact_person ?? "—"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground truncate max-w-28">
                      {c.industry ?? "—"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground truncate max-w-24">
                      {c.town ?? "—"}
                    </td>
                    <td className="py-3 px-4 text-right text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                    </td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Restore contact"
                          disabled={actionLoading === c.id}
                          onClick={() => handleRestore(c.id)}
                        >
                          <ArchiveRestore className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          title="Delete permanently"
                          disabled={actionLoading === c.id}
                          onClick={() => handleDelete(c.id, c.company_name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
