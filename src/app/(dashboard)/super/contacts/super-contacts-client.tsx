"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DialogFooter,
} from "@/components/ui/dialog";
import { Search, UserCheck, Shuffle, Upload, Plus, Loader2, CheckCircle, AlertTriangle, Phone, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { AddContactDialog } from "@/components/add-contact-dialog";
import type { Contact } from "@/types/database";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  no_answer: "No Answer",
  not_exists: "Not Exists",
  interested: "Interested",
  send_proposal: "Send Proposal",
  send_email: "Send Email",
  directory_note: "Directory Note",
  converted: "Converted",
};

interface SuperContactsClientProps {
  contacts: (Contact & {
    profiles?: { id: string; full_name: string } | null;
  })[];
  salesPeople: { id: string; full_name: string }[];
  salesCountsArray: { id: string; count: number }[];
  unassignedCount: number;
  grandTotal: number;
  totalMatching: number;
  page: number;
  pageSize: number;
  initialSearch: string;
  initialSalesFilter: string;
}

export function SuperContactsClient({
  contacts,
  salesPeople,
  salesCountsArray,
  unassignedCount,
  grandTotal,
  totalMatching,
  page,
  pageSize,
  initialSearch,
  initialSalesFilter,
}: SuperContactsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNavPending, startTransition] = useTransition();

  // Local search state shadows ?q in the URL. We push to the URL on a
  // 300ms debounce so each keystroke doesn't trigger a server fetch.
  const [search, setSearch] = useState(initialSearch);
  const lastPushedSearch = useRef(initialSearch);

  // Selected contacts (current page only — see "Reassign matching" for
  // cross-page bulk ops).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reassign N selected
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState("");
  const [reassigning, setReassigning] = useState(false);

  // Quick Assign (RPC contacts_quick_assign)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchCount, setBatchCount] = useState("");
  const [batchTarget, setBatchTarget] = useState("");
  const [batchAssigning, setBatchAssigning] = useState(false);

  // Reassign all matching the current filter (RPC contacts_reassign_matching)
  const [matchingDialogOpen, setMatchingDialogOpen] = useState(false);
  const [matchingTarget, setMatchingTarget] = useState("");
  const [matchingAssigning, setMatchingAssigning] = useState(false);

  // CSV upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    total_parsed: number; inserted: number; duplicates: number; errors: number; message: string;
  } | null>(null);

  // Add single contact
  const [addContactOpen, setAddContactOpen] = useState(false);

  // Quick edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  // Reset selection whenever the underlying page changes (search, filter,
  // pagination) so "Reassign N selected" never operates on stale IDs.
  useEffect(() => {
    setSelected(new Set());
  }, [contacts]);

  // Debounced URL sync for search. Page resets to 1 on new search.
  useEffect(() => {
    if (search === lastPushedSearch.current) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      const trimmed = search.trim();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      params.delete("page");
      lastPushedSearch.current = trimmed;
      startTransition(() => {
        router.replace(`?${params.toString()}`);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchParams, router]);

  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.replace(`?${params.toString()}`));
  }

  function startEdit(c: typeof contacts[0]) {
    setEditingId(c.id);
    const phones = (c as unknown as { phones?: string[] }).phones || [];
    setEditForm({
      company_name: c.company_name || "",
      contact_person: c.contact_person || "",
      phone: c.phone || "",
      phones: phones as unknown as string,
      email: c.email || "",
      town: c.town || "",
      industry: c.industry || "",
      website_url: c.website_url || "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    const supabase = createClient();
    const phones = (editForm.phones as unknown as string[])?.filter(p => p.trim()) || [];
    const { error } = await supabase.from("contacts").update({
      company_name: editForm.company_name || null,
      contact_person: editForm.contact_person || null,
      phone: phones[0] || editForm.phone || null,
      phones: phones.length > 0 ? phones : null,
      email: editForm.email || null,
      town: editForm.town || null,
      industry: editForm.industry || null,
      website_url: editForm.website_url || null,
    }).eq("id", editingId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Contact updated");
      setEditingId(null);
      startTransition(() => router.refresh());
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/super/contacts/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Upload failed");
        setUploading(false);
        return;
      }
      setUploadResult(data);
      toast.success(data.message);
      startTransition(() => router.refresh());
    } catch {
      toast.error("Upload failed — check your file and try again");
    }
    setUploading(false);
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleSelectAll() {
    if (selected.size === contacts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map((c) => c.id)));
    }
  }

  async function handleReassign() {
    if (!reassignTarget || selected.size === 0) return;
    setReassigning(true);
    const supabase = createClient();
    const ids = Array.from(selected);

    const { error } = await supabase
      .from("contacts")
      .update({
        assigned_to: reassignTarget === "unassign" ? null : reassignTarget,
        assigned_at:
          reassignTarget === "unassign" ? null : new Date().toISOString(),
      })
      .in("id", ids);

    if (error) {
      toast.error(error.message);
    } else {
      const name =
        reassignTarget === "unassign"
          ? "unassigned"
          : (salesPeople.find((s) => s.id === reassignTarget)?.full_name ?? "");
      toast.success(`${ids.length} contact(s) reassigned to ${name}`);
      setSelected(new Set());
      setReassignDialogOpen(false);
      startTransition(() => router.refresh());
    }
    setReassigning(false);
  }

  async function handleBatchAssign() {
    if (!batchTarget || !batchCount) return;
    const count = parseInt(batchCount, 10);
    if (!count || count <= 0) return;

    setBatchAssigning(true);
    const supabase = createClient();

    const { data, error } = await supabase.rpc("contacts_quick_assign", {
      p_count: count,
      p_target_id: batchTarget,
    });

    if (error) {
      toast.error(error.message);
    } else {
      const updated = Number(data ?? 0);
      const name = salesPeople.find((s) => s.id === batchTarget)?.full_name ?? "";
      toast.success(`${updated} contacts assigned to ${name}`);
      setBatchDialogOpen(false);
      setBatchCount("");
      setBatchTarget("");
      startTransition(() => router.refresh());
    }
    setBatchAssigning(false);
  }

  async function handleReassignMatching() {
    if (!matchingTarget) return;
    setMatchingAssigning(true);
    const supabase = createClient();

    // Must mirror the same normalization the listing page applies before
    // building its .or() ILIKE clause, or the "N matching" count shown on
    // the button would diverge from the rows the RPC actually touches.
    const normalizedSearch = initialSearch
      ? initialSearch.replace(/[,()]/g, " ").trim()
      : "";

    const { data, error } = await supabase.rpc("contacts_reassign_matching", {
      p_search: normalizedSearch || null,
      p_sales_filter: initialSalesFilter === "all" ? null : initialSalesFilter,
      p_target_id: matchingTarget === "unassign" ? null : matchingTarget,
    });

    if (error) {
      toast.error(error.message);
    } else {
      const updated = Number(data ?? 0);
      const name =
        matchingTarget === "unassign"
          ? "unassigned"
          : (salesPeople.find((s) => s.id === matchingTarget)?.full_name ?? "");
      toast.success(`${updated} contact(s) reassigned to ${name}`);
      setMatchingDialogOpen(false);
      setMatchingTarget("");
      startTransition(() => router.refresh());
    }
    setMatchingAssigning(false);
  }

  const salesCountsMap = new Map(salesCountsArray.map((r) => [r.id, r.count]));
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  const rangeStart = totalMatching === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalMatching);
  const hasFilter = !!(initialSearch || initialSalesFilter !== "all");

  return (
    <TooltipProvider>
    <Tabs defaultValue="all" className="space-y-6">
      <TabsList>
        <TabsTrigger value="all">
          All Contacts ({grandTotal.toLocaleString()})
        </TabsTrigger>
        <TabsTrigger value="distribution">Distribution</TabsTrigger>
      </TabsList>

      <TabsContent value="all" className="space-y-6">
        {/* Upload + Add */}
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} asChild>
                  <span>
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {uploading ? "Uploading..." : "Import CSV"}
                  </span>
                </Button>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-xs">
              Upload a CSV file with columns: Name, Category, Website, Phone 1/2/3, Email, City, State. Duplicates are automatically skipped by phone number. Max ~50k rows per file.
            </TooltipContent>
          </Tooltip>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddContactOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Contact
          </Button>

          {uploadResult && (
            <div className="flex items-center gap-2 text-xs ml-2">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-emerald-600 font-medium">{uploadResult.inserted} imported</span>
              {uploadResult.duplicates > 0 && (
                <span className="text-amber-600">{uploadResult.duplicates} duplicates skipped</span>
              )}
              {uploadResult.errors > 0 && (
                <span className="text-red-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {uploadResult.errors} errors
                </span>
              )}
            </div>
          )}
        </div>

        {/* Filters + Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-50">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
            {isNavPending && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <Select
            value={initialSalesFilter}
            onValueChange={(v) => updateUrl({ sales: v === "all" ? null : v, page: null })}
          >
            <SelectTrigger className="w-50">
              <SelectValue placeholder="Filter by salesperson" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unassigned">
                Unassigned ({unassignedCount.toLocaleString()})
              </SelectItem>
              {salesPeople.map((sp) => (
                <SelectItem key={sp.id} value={sp.id}>
                  {sp.full_name} ({(salesCountsMap.get(sp.id) ?? 0).toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected.size > 0 && (
            <Button size="sm" onClick={() => setReassignDialogOpen(true)}>
              <UserCheck className="mr-1.5 h-3.5 w-3.5" />
              Reassign {selected.size} selected
            </Button>
          )}
          {hasFilter && totalMatching > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMatchingDialogOpen(true)}>
              <Shuffle className="h-3.5 w-3.5" />
              Reassign all {totalMatching.toLocaleString()} matching
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBatchDialogOpen(true)}>
            <Shuffle className="h-3.5 w-3.5" />
            Quick Assign
          </Button>
          <span className="text-xs text-muted-foreground">
            {unassignedCount.toLocaleString()} unassigned · {grandTotal.toLocaleString()} total
          </span>
        </div>

        <Card>
          <CardContent className="p-0 [&_th]:py-1.5 [&_td]:py-1 max-h-[calc(100vh-260px)] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === contacts.length && contacts.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </TableHead>
                  <TableHead className="w-28">Assigned To</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                      No contacts found.
                    </TableCell>
                  </TableRow>
                ) : (
                  contacts.map((c) => (
                    <TableRow key={c.id} className="text-[11px] h-6">
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={c.assigned_to || "unassigned"}
                          onValueChange={async (val) => {
                            const supabase = createClient();
                            const assignTo = val === "unassigned" ? null : val;
                            await supabase.from("contacts").update({
                              assigned_to: assignTo,
                              assigned_at: assignTo ? new Date().toISOString() : null,
                            }).eq("id", c.id);
                            const name = salesPeople.find(s => s.id === val)?.full_name || "Unassigned";
                            toast.success(`${c.company_name} → ${name}`);
                            startTransition(() => router.refresh());
                          }}
                        >
                          <SelectTrigger className="h-5 text-[10px] w-24 px-1.5">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">
                              <span className="text-muted-foreground">Unassigned</span>
                            </SelectItem>
                            {salesPeople.map(sp => (
                              <SelectItem key={sp.id} value={sp.id}>{sp.full_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          c.status === "new" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" :
                          c.status === "callback" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" :
                          c.status === "send_proposal" ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300" :
                          c.status === "not_interested" || c.status === "never_contact" ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" :
                          "bg-muted text-muted-foreground"
                        }`}>{STATUS_LABELS[c.status] ?? c.status}</span>
                      </TableCell>
                      {editingId === c.id ? (
                        <>
                          <TableCell><input value={editForm.company_name} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))} className="h-5 text-[10px] px-1 w-28 bg-transparent border-b border-primary/30 outline-none" /></TableCell>
                          <TableCell><input value={editForm.town} onChange={e => setEditForm(f => ({ ...f, town: e.target.value }))} className="h-5 text-[10px] px-1 w-16 bg-transparent border-b border-primary/30 outline-none" /></TableCell>
                          <TableCell><span className="text-muted-foreground text-[10px]">{c.state || "—"}</span></TableCell>
                          <TableCell>
                            <div className="space-y-0.5">
                              {((editForm as unknown as { phones: string[] }).phones || []).map((p: string, i: number) => (
                                <div key={i} className="flex items-center gap-0.5">
                                  <input value={p} onChange={e => {
                                    const updated = [...((editForm as unknown as { phones: string[] }).phones || [])];
                                    updated[i] = e.target.value;
                                    setEditForm(f => ({ ...f, phones: updated as unknown as string }));
                                  }} className="h-5 text-[10px] px-1 w-24 bg-transparent border-b border-primary/30 outline-none" />
                                </div>
                              ))}
                              {!((editForm as unknown as { phones: string[] }).phones || []).length && (
                                <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="h-5 text-[10px] px-1 w-24 bg-transparent border-b border-primary/30 outline-none" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell><input value={editForm.industry} onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))} className="h-5 text-[10px] px-1 w-16 bg-transparent border-b border-primary/30 outline-none" /></TableCell>
                          <TableCell><input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="h-5 text-[10px] px-1 w-24 bg-transparent border-b border-primary/30 outline-none" /></TableCell>
                          <TableCell><input value={editForm.website_url} onChange={e => setEditForm(f => ({ ...f, website_url: e.target.value }))} className="h-5 text-[10px] px-1 w-24 bg-transparent border-b border-primary/30 outline-none" /></TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              <Button size="sm" className="h-5 text-[9px] px-1.5" onClick={saveEdit}>Save</Button>
                              <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1" onClick={() => setEditingId(null)}>X</Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="max-w-40">
                            <Tooltip><TooltipTrigger asChild><span className="font-medium truncate block">{c.company_name}</span></TooltipTrigger><TooltipContent>{c.company_name}</TooltipContent></Tooltip>
                          </TableCell>
                          <TableCell className="max-w-20">
                            {c.town ? <Tooltip><TooltipTrigger asChild><span className="truncate block">{c.town}</span></TooltipTrigger><TooltipContent>{c.town}</TooltipContent></Tooltip> : <span className="text-muted-foreground text-[10px]">No city</span>}
                          </TableCell>
                          <TableCell className="max-w-20">
                            {c.state ? <Tooltip><TooltipTrigger asChild><span className="truncate block">{c.state}</span></TooltipTrigger><TooltipContent>{c.state}</TooltipContent></Tooltip> : <span className="text-muted-foreground text-[10px]">No state</span>}
                          </TableCell>
                          <TableCell>
                            {c.phone ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a href={`tel:${c.phone}`} className="text-primary hover:underline cursor-pointer">{c.phone}</a>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="p-0">
                                  {(c as unknown as { phones?: string[] }).phones?.length ? (
                                    <div className="py-1">
                                      {(c as unknown as { phones?: string[] }).phones!.map((p, i) => (
                                        <a key={i} href={`tel:${p}`} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer">
                                          <Phone className="h-3 w-3" /> {p}
                                        </a>
                                      ))}
                                    </div>
                                  ) : (
                                    <a href={`tel:${c.phone}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                                      <Phone className="h-3 w-3" /> {c.phone}
                                    </a>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground text-[10px]">No phone</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-20">
                            {c.industry ? <Tooltip><TooltipTrigger asChild><span className="truncate block">{c.industry}</span></TooltipTrigger><TooltipContent>{c.industry}</TooltipContent></Tooltip> : <span className="text-muted-foreground text-[10px]">No industry</span>}
                          </TableCell>
                          <TableCell className="max-w-28">
                            {c.email ? <Tooltip><TooltipTrigger asChild><span className="truncate block">{c.email}</span></TooltipTrigger><TooltipContent>{c.email}</TooltipContent></Tooltip> : <span className="text-muted-foreground text-[10px]">No email</span>}
                          </TableCell>
                          <TableCell className="max-w-24">
                            {c.website_url ? <Tooltip><TooltipTrigger asChild><a href={c.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate block">{c.website_url.replace(/^https?:\/\/(www\.)?/, "")}</a></TooltipTrigger><TooltipContent>{c.website_url}</TooltipContent></Tooltip> : <span className="text-[10px] text-emerald-600">No website</span>}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(c)}>
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {totalMatching === 0
              ? "0 results"
              : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${totalMatching.toLocaleString()}${hasFilter ? " matching" : ""}`}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || isNavPending}
              onClick={() => updateUrl({ page: page <= 2 ? null : String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages.toLocaleString()}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || isNavPending}
              onClick={() => updateUrl({ page: String(page + 1) })}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="distribution" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Contact Distribution by Salesperson</CardTitle>
            <CardDescription>
              {unassignedCount.toLocaleString()} unassigned contacts available for batch
              assignment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesPeople.map((sp) => {
                  const count = salesCountsMap.get(sp.id) ?? 0;
                  const pct =
                    grandTotal > 0
                      ? ((count / grandTotal) * 100).toFixed(1)
                      : "0";
                  return (
                    <TableRow key={sp.id}>
                      <TableCell className="font-medium">
                        {sp.full_name}
                      </TableCell>
                      <TableCell className="text-right">{count.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{pct}%</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground italic">
                    Unassigned
                  </TableCell>
                  <TableCell className="text-right">
                    {unassignedCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {grandTotal > 0
                      ? ((unassignedCount / grandTotal) * 100).toFixed(1)
                      : "0"}
                    %
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Button variant="outline" onClick={() => setBatchDialogOpen(true)}>
          <Shuffle className="mr-2 h-4 w-4" />
          Batch Assign Unassigned Contacts
        </Button>
      </TabsContent>

      {/* Reassign N selected dialog */}
      <Dialog open={reassignDialogOpen} onOpenChange={setReassignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign {selected.size} Contact(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Select value={reassignTarget} onValueChange={setReassignTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select salesperson" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassign">
                  Unassign (remove from all)
                </SelectItem>
                {salesPeople.map((sp) => (
                  <SelectItem key={sp.id} value={sp.id}>
                    {sp.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setReassignDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleReassign}
                disabled={!reassignTarget || reassigning}
              >
                {reassigning ? "Reassigning..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reassign all matching the filter dialog */}
      <Dialog open={matchingDialogOpen} onOpenChange={setMatchingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reassign {totalMatching.toLocaleString()} contact(s) matching the current filter
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              This operates across <strong>all pages</strong> matching the current search and filter — not just the current page.
            </div>
            <Select value={matchingTarget} onValueChange={setMatchingTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select salesperson" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassign">
                  Unassign (remove from all)
                </SelectItem>
                {salesPeople.map((sp) => (
                  <SelectItem key={sp.id} value={sp.id}>
                    {sp.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMatchingDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleReassignMatching} disabled={!matchingTarget || matchingAssigning}>
                {matchingAssigning ? "Reassigning..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Assign Dialog */}
      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base">Quick Assign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <strong>{unassignedCount.toLocaleString()}</strong> unassigned contacts available
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Assign to</Label>
              <Select value={batchTarget} onValueChange={setBatchTarget}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select salesperson..." />
                </SelectTrigger>
                <SelectContent>
                  {salesPeople.map((sp) => (
                    <SelectItem key={sp.id} value={sp.id}>
                      {sp.full_name} ({(salesCountsMap.get(sp.id) ?? 0).toLocaleString()} assigned)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">How many contacts?</Label>
              <div className="flex gap-2">
                {[50, 100, 200, 500].map(n => (
                  <Button key={n} type="button" size="sm" variant={batchCount === String(n) ? "default" : "outline"} className="h-8 text-xs"
                    onClick={() => setBatchCount(String(Math.min(n, unassignedCount)))}>
                    {n}
                  </Button>
                ))}
                <Input
                  type="number"
                  min="1"
                  max={unassignedCount}
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  placeholder="Custom"
                  className="h-8 text-sm w-24"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleBatchAssign} disabled={!batchTarget || !batchCount || batchAssigning}>
                {batchAssigning ? "Assigning..." : `Assign ${batchCount || 0} contacts`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <AddContactDialog
        open={addContactOpen}
        onOpenChange={setAddContactOpen}
        onCreated={() => startTransition(() => router.refresh())}
      />
    </Tabs>
    </TooltipProvider>
  );
}
