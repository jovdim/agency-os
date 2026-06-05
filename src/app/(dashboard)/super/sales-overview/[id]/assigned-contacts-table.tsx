"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";

export interface AssignedContactRow {
  id: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  town: string | null;
  industry: string | null;
  status: string;
}

export function AssignedContactsTable({
  contacts,
  statusLabels,
}: {
  contacts: AssignedContactRow[];
  statusLabels: Record<string, string>;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [
        c.company_name,
        c.email,
        c.phone,
        c.town,
        c.industry,
        statusLabels[c.status] || c.status,
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [contacts, query, statusLabels]);

  return (
    <div>
      <div className="px-4 pb-3">
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Website</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-8 text-muted-foreground text-sm"
              >
                {contacts.length === 0
                  ? "No contacts assigned"
                  : "No contacts match your search"}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((c) => (
              <TableRow key={c.id} className="text-xs">
                <TableCell>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {statusLabels[c.status] || c.status}
                  </span>
                </TableCell>
                <TableCell className="font-medium truncate max-w-48">
                  {c.company_name}
                </TableCell>
                <TableCell>
                  {c.town || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {c.industry || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {c.email || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {c.website_url ? (
                    <a
                      href={c.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline truncate max-w-24 block"
                    >
                      {c.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
