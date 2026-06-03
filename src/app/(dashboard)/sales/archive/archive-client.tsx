"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
  FileText,
} from "lucide-react";
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
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Archive className="h-5 w-5" />
          Archive
        </h1>
        <p className="text-sm text-muted-foreground">
          {initialContacts.length} archived contact{initialContacts.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Search */}
      {initialContacts.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-md border py-16 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">
            {search ? "No contacts match your search." : "No archived contacts."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 px-3 text-right font-medium w-8">#</th>
                  <th className="py-2 px-3 text-left font-medium min-w-44">Company</th>
                  <th className="py-2 px-3 text-left font-medium min-w-28">Contact</th>
                  <th className="py-2 px-3 text-left font-medium min-w-28">Industry</th>
                  <th className="py-2 px-3 text-left font-medium min-w-24">Town</th>
                  <th className="py-2 px-3 text-right font-medium min-w-28">Archived</th>
                  <th className="py-2 px-3 text-center font-medium w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr
                    key={c.id}
                    data-interactive="true"
                    className="border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => router.push(`/sales/contacts/${c.id}`)}
                  >
                    <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums text-xs">
                      {idx + 1}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className="font-medium hover:text-primary transition-colors truncate block max-w-44">
                        {c.company_name}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-28">
                      {c.contact_person ?? "—"}
                    </td>
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-28">
                      {c.industry ?? "—"}
                    </td>
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-24">
                      {c.town ?? "—"}
                    </td>
                    <td className="py-1.5 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                    </td>
                    <td className="py-1.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Restore contact"
                          disabled={actionLoading === c.id}
                          onClick={() => handleRestore(c.id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          title="Delete permanently"
                          disabled={actionLoading === c.id}
                          onClick={() => handleDelete(c.id, c.company_name)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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
