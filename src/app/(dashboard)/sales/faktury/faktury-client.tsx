"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Clock, Download, FileText, Search, Send, CheckCircle2 } from "lucide-react";
import { SendToClientDialog } from "./send-to-client-dialog";

interface InvoiceRequest {
  id: string;
  company_name: string;
  message: string;
  is_done: boolean;
  created_at: string;
  admin_response: string | null;
  responded_at: string | null;
  invoice_file_path: string | null;
  invoice_file_name: string | null;
  invoice_file_uploaded_at: string | null;
  sent_to_client_at: string | null;
  sent_to_client_email: string | null;
  contact_email: string | null;
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function FakturyClient({ requests }: { requests: InvoiceRequest[] }) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "pending" | "done">("all");
  const [sendDialog, setSendDialog] = useState<InvoiceRequest | null>(null);

  const filtered = requests.filter((r) => {
    if (tab === "pending" && r.is_done) return false;
    if (tab === "done" && !r.is_done) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.company_name.toLowerCase().includes(q) ||
      r.message.toLowerCase().includes(q)
    );
  });

  const pendingCount = requests.filter((r) => !r.is_done).length;
  const doneCount = requests.filter((r) => r.is_done).length;
  const withPdfCount = requests.filter((r) => r.invoice_file_path).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your invoice requests. Once an invoice is created, you'll find the
            PDF to download here.
          </p>
        </div>
        {withPdfCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {withPdfCount} PDFs to download
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex border-b">
          <button
            onClick={() => setTab("all")}
            className={`px-3 py-2 text-sm font-medium ${tab === "all" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            All ({requests.length})
          </button>
          <button
            onClick={() => setTab("pending")}
            className={`px-3 py-2 text-sm font-medium ${tab === "pending" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setTab("done")}
            className={`px-3 py-2 text-sm font-medium ${tab === "done" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            Done ({doneCount})
          </button>
        </div>
        <div className="relative w-56 ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or description…"
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden [&_td]:py-2 [&_th]:py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Created</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="max-w-md">Description</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-44">Invoice</TableHead>
              <TableHead className="w-40">Client</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-muted-foreground text-sm"
                >
                  {requests.length === 0
                    ? "You haven't sent any invoice requests yet."
                    : "No results for these filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((req) => (
                <TableRow key={req.id} className="text-sm">
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <Clock className="h-3 w-3" />
                      {timeAgo(req.created_at)}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(req.created_at).toLocaleDateString("en-US")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{req.company_name}</span>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <p className="text-xs whitespace-pre-wrap line-clamp-3">
                      {req.message}
                    </p>
                  </TableCell>
                  <TableCell>
                    {req.is_done ? (
                      <Badge
                        variant="secondary"
                        className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      >
                        Done
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                    {req.is_done && req.admin_response && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {req.admin_response}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {req.invoice_file_path ? (
                      <a
                        href={`/api/admin/invoice-requests/${req.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span className="truncate max-w-32">
                          {req.invoice_file_name || "Invoice.pdf"}
                        </span>
                      </a>
                    ) : req.is_done ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        No PDF
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {req.invoice_file_path ? (
                      req.sent_to_client_at ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Sent {timeAgo(req.sent_to_client_at)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSendDialog(req)}
                            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline text-left"
                          >
                            Send again
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => setSendDialog(req)}
                        >
                          <Send className="h-3 w-3" />
                          Send to client
                        </Button>
                      )
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {sendDialog && (
        <SendToClientDialog
          open={!!sendDialog}
          onOpenChange={(open) => {
            if (!open) setSendDialog(null);
          }}
          requestId={sendDialog.id}
          companyName={sendDialog.company_name}
          fileName={sendDialog.invoice_file_name || "Invoice.pdf"}
          defaultRecipient={
            sendDialog.sent_to_client_email || sendDialog.contact_email || ""
          }
          alreadySent={!!sendDialog.sent_to_client_at}
        />
      )}
    </div>
  );
}
