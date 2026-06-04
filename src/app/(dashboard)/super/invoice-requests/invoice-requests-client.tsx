"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  Search,
  Clock,
  X,
  Upload,
  FileText,
  Download,
  Inbox,
  CheckCircle2,
  Receipt,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

interface InvoiceRequest {
  id: string;
  contact_id: string | null;
  company_name: string;
  message: string;
  is_done: boolean;
  created_at: string;
  sales_person_id: string;
  profiles: { full_name: string } | null;
  admin_response?: string | null;
  responded_at?: string | null;
  invoice_file_path?: string | null;
  invoice_file_name?: string | null;
  invoice_file_uploaded_at?: string | null;
}

interface Props {
  pending: InvoiceRequest[];
  done: InvoiceRequest[];
}

// A pending request is "stale" once it's been waiting longer than this.
// Used to surface an orange dot on the card so old requests stay top of
// mind without overlapping with the rest of the row's information.
const STALE_AFTER_HOURS = 48;

export function InvoiceRequestsClient({ pending, done }: Props) {
  const router = useRouter();
  const [marking, setMarking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const [respondTo, setRespondTo] = useState<InvoiceRequest | null>(null);
  const [response, setResponse] = useState("");
  const [responseType, setResponseType] = useState<"done" | "reject">("done");
  // File staged in the Done dialog. Cleared whenever the dialog closes
  // or after a successful upload+commit.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Oldest pending request, by created_at ascending. Used in the stat
  // row header to surface "how behind are you?" at a glance. Memoized
  // so we don't re-walk the array on every render.
  const oldestPending = useMemo(() => {
    if (pending.length === 0) return null;
    // The server already sorted by created_at DESC, so the oldest is
    // the last item in the list.
    return pending[pending.length - 1];
  }, [pending]);

  async function handleRespond() {
    if (!respondTo) return;
    setMarking(respondTo.id);

    try {
      // Step 1: if a file is attached AND we're marking "done", upload
      // it first. Reject path skips the upload (you don't attach a PDF
      // to a rejection).
      if (responseType === "done" && pendingFile) {
        const fd = new FormData();
        fd.append("file", pendingFile);
        const res = await fetch(
          `/api/admin/invoice-requests/${respondTo.id}/upload`,
          { method: "POST", body: fd },
        );
        if (!res.ok) {
          const { error: msg } = await res
            .json()
            .catch(() => ({ error: "Upload failed" }));
          toast.error(`Upload failed: ${msg ?? res.statusText}`);
          setMarking(null);
          return;
        }
      }

      // Step 2: mark the row done (or rejected) with the operator's note.
      const supabase = createClient();
      const { error } = await supabase
        .from("invoice_requests")
        .update({
          is_done: true,
          admin_response:
            response.trim() ||
            (responseType === "done" ? "Invoice created" : "Rejected"),
          responded_at: new Date().toISOString(),
        })
        .eq("id", respondTo.id);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      toast.success(
        responseType === "done"
          ? pendingFile
            ? "Marked done + PDF uploaded"
            : "Marked as done"
          : "Rejected",
      );
      setRespondTo(null);
      setResponse("");
      setPendingFile(null);
      router.refresh();
    } finally {
      setMarking(null);
    }
  }

  async function handleDownload(id: string) {
    // Open in a new tab — the route 302-redirects to a signed Storage URL.
    window.open(`/api/admin/invoice-requests/${id}/download`, "_blank");
  }

  // Reopen a Done request — flips it back into Pending. Used to undo
  // an accidental Mark Done without going to the database. The
  // invoice_file_* columns are intentionally kept so the file stays
  // attached; the next Mark Done can either reuse it or replace it
  // via a new upload.
  async function handleReopen(req: InvoiceRequest) {
    if (
      !confirm(
        `Reopen this request from ${req.company_name}? It will move back to Pending.`,
      )
    ) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("invoice_requests")
      .update({
        is_done: false,
        admin_response: null,
        responded_at: null,
      })
      .eq("id", req.id);
    if (error) {
      toast.error("Failed to reopen");
      return;
    }
    toast.success("Reopened — moved back to Pending");
    router.refresh();
  }

  // Time-to-resolve in human-readable form. From created_at to
  // responded_at. Returns null when responded_at is missing.
  function resolveDuration(req: InvoiceRequest): string | null {
    if (!req.responded_at) return null;
    const ms =
      new Date(req.responded_at).getTime() - new Date(req.created_at).getTime();
    if (ms < 0) return null;
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  const items = tab === "pending" ? pending : done;
  const filtered = items.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.company_name.toLowerCase().includes(q) ||
      r.message.toLowerCase().includes(q) ||
      r.profiles?.full_name.toLowerCase().includes(q)
    );
  });

  // Group Done items by the month they were COMPLETED (responded_at),
  // falling back to created_at on the off chance a done row has no
  // responded_at (legacy data). Groups come out in the order they're
  // first seen, which — because `filtered` is sorted DESC by created_at
  // and we read responded_at first — gives "most recent month at top",
  // matching the way an accountant scans a ledger.
  const doneByMonth = useMemo(() => {
    if (tab !== "done") return [];
    const map = new Map<string, { year: number; month: number; items: InvoiceRequest[] }>();
    for (const r of filtered) {
      const d = new Date(r.responded_at || r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { year: d.getFullYear(), month: d.getMonth(), items: [] };
        map.set(key, bucket);
      }
      bucket.items.push(r);
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [tab, filtered]);

  function monthLabel(year: number, month: number): string {
    return new Date(year, month, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  function timeAgo(date: string) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function hoursSince(date: string) {
    return (Date.now() - new Date(date).getTime()) / 3600000;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Invoice Requests</h1>
        <p className="text-sm text-muted-foreground">
          Fulfil sales-team invoice requests — generate the PDF, attach it
          here.
        </p>
      </div>

      {/* Stat row — 3 cards giving the "shape of the queue" before you
          scroll. Pending count, oldest-pending age (the urgency
          signal), and a quick done count. */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`text-2xl font-bold ${
                  pending.length > 0 ? "" : "text-muted-foreground"
                }`}
              >
                {pending.length}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Pending
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <Inbox className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`text-2xl font-bold ${
                  oldestPending && hoursSince(oldestPending.created_at) > STALE_AFTER_HOURS
                    ? "text-orange-600 dark:text-orange-400"
                    : "text-muted-foreground"
                }`}
              >
                {oldestPending ? timeAgo(oldestPending.created_at) : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Oldest pending
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold text-muted-foreground">
                {done.length}
                {done.length >= 200 && (
                  <span className="text-sm font-normal">+</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Done (recent)
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => setTab("pending")}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
              tab === "pending"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Pending
            {pending.length > 0 && (
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-4 h-4 text-[10px] font-semibold tabular-nums ${
                  tab === "pending"
                    ? "bg-foreground/10 text-foreground"
                    : "bg-foreground/10 text-muted-foreground"
                }`}
              >
                {pending.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("done")}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
              tab === "done"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Done
          </button>
        </div>
        <div className="relative w-56 ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* Listing — cards for pending (inbox feel), table for done
          (audit feel). Two different shapes because the two tabs serve
          two different jobs. */}
      {tab === "pending" ? (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="rounded-lg border bg-card p-12 text-center">
              <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                {search ? "No matching requests" : "All caught up — no pending requests."}
              </p>
            </div>
          ) : (
            filtered.map((req) => {
              const isStale = hoursSince(req.created_at) > STALE_AFTER_HOURS;
              return (
                <div
                  key={req.id}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  <div className="px-4 py-3 flex items-start justify-between gap-3 border-b">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isStale && (
                          <span
                            className="h-2 w-2 rounded-full bg-orange-500 shrink-0"
                            aria-label="Older than 48 hours"
                            title="Older than 48h"
                          />
                        )}
                        <h3 className="font-semibold text-sm truncate">
                          {req.company_name}
                        </h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        from{" "}
                        <span className="font-medium">
                          {req.profiles?.full_name || "—"}
                        </span>
                        <span className="mx-1.5 text-muted-foreground/40">·</span>
                        <span className={isStale ? "text-orange-600 dark:text-orange-400" : ""}>
                          {timeAgo(req.created_at)}
                        </span>
                        <span className="mx-1.5 text-muted-foreground/40">·</span>
                        <span className="text-muted-foreground/70">
                          {new Date(req.created_at).toLocaleDateString("en-US")}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-sm whitespace-pre-wrap text-foreground/90 border-l-2 border-muted pl-3">
                      {req.message}
                    </div>
                  </div>
                  <div className="px-4 py-2.5 bg-muted/30 border-t flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-muted-foreground hover:text-red-500"
                      onClick={() => {
                        setRespondTo(req);
                        setResponseType("reject");
                        setResponse("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => {
                        setRespondTo(req);
                        setResponseType("done");
                        setResponse("");
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Mark Done
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Receipt className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "No matching done requests"
              : "No completed requests yet"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {doneByMonth.map((group) => (
            <div key={group.key}>
              {/* Month header — date label + count. Sits above the
                  table like a section divider in a paper ledger. */}
              <div className="flex items-baseline gap-2 mb-2 px-1">
                <h3 className="text-sm font-semibold">
                  {monthLabel(group.year, group.month)}
                </h3>
                <span className="text-xs text-muted-foreground">
                  · {group.items.length}{" "}
                  {group.items.length === 1 ? "request" : "requests"}
                </span>
              </div>
              <div className="rounded-lg border bg-card overflow-hidden [&_td]:py-2.5 [&_th]:py-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">When</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead className="w-20">Took</TableHead>
                      <TableHead>Response</TableHead>
                      <TableHead className="w-32">Invoice</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((req) => {
                      const took = resolveDuration(req);
                      return (
                        <TableRow key={req.id} className="text-sm group">
                          <TableCell>
                            <p className="text-xs text-muted-foreground">
                              {timeAgo(req.responded_at || req.created_at)}
                            </p>
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                              {new Date(
                                req.responded_at || req.created_at,
                              ).toLocaleDateString("en-US")}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">
                              {req.company_name}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">
                              {req.profiles?.full_name || "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {took ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {req.admin_response || "Done"}
                            </p>
                          </TableCell>
                          <TableCell>
                            {req.invoice_file_path ? (
                              <button
                                type="button"
                                onClick={() => handleDownload(req.id)}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-foreground/70 transition-colors"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span className="truncate max-w-24">
                                  {req.invoice_file_name || "Invoice.pdf"}
                                </span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/60">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {/* Reopen — appears on hover so the row
                                stays clean at rest, but is one click
                                away when something needs undoing. */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              onClick={() => handleReopen(req)}
                              title="Move back to Pending"
                            >
                              <Undo2 className="h-3 w-3" />
                              Reopen
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Response Dialog — unchanged from prior revision. Shared between
          "Mark Done" (with optional PDF upload) and "Reject" (no PDF). */}
      <Dialog
        open={!!respondTo}
        onOpenChange={(v) => {
          if (!v) {
            setRespondTo(null);
            setPendingFile(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {responseType === "done" ? "Complete Invoice Request" : "Reject Request"}
            </DialogTitle>
          </DialogHeader>
          {respondTo && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                  {respondTo.company_name}
                </p>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                  {respondTo.message}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  from {respondTo.profiles?.full_name} ·{" "}
                  {new Date(respondTo.created_at).toLocaleDateString("en-US")}
                </p>
              </div>

              {/* File upload — only for the "done" path. Rejecting doesn't
                  need a PDF attachment. */}
              {responseType === "done" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Invoice PDF (optional)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 cursor-pointer">
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          if (f && f.size > 20 * 1024 * 1024) {
                            toast.error("File is too large (max 20 MB)");
                            return;
                          }
                          setPendingFile(f);
                        }}
                      />
                      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs hover:bg-muted/40 transition-colors">
                        <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate flex-1">
                          {pendingFile ? pendingFile.name : "Choose PDF…"}
                        </span>
                        {pendingFile && (
                          <span className="text-[10px] text-muted-foreground">
                            {(pendingFile.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        )}
                      </div>
                    </label>
                    {pendingFile && (
                      <button
                        type="button"
                        onClick={() => setPendingFile(null)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    The salesperson will see the PDF in their dashboard once marked as done.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium">
                  {responseType === "done"
                    ? "Response to salesperson (e.g. invoice number)"
                    : "Reason for rejection"}
                </label>
                <Textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder={
                    responseType === "done"
                      ? "e.g. Invoice FV-20260329-001 created and sent"
                      : "e.g. Need more details about services"
                  }
                  className="text-sm min-h-16"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRespondTo(null);
                setPendingFile(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={responseType === "done" ? "default" : "destructive"}
              disabled={marking === respondTo?.id}
              onClick={handleRespond}
            >
              {marking === respondTo?.id
                ? "..."
                : responseType === "done"
                  ? pendingFile
                    ? "Upload + Mark Done"
                    : "Mark as Done"
                  : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
