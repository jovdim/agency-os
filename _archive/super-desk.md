# Super Admin – Desk (removed 2026-05-20)

The "Management Desk" surface on `/super/desk` was retired at Peter's
request. This file is a complete snapshot so the feature can be put
back in place verbatim later.

The underlying database table `client_tasks` (created by migration
`00027_client_tasks.sql`) was **not** dropped — any rows you had stay
intact, just nothing reads or writes them via this surface anymore.

> Caveat: `src/app/api/contacts/[id]/invoice-request/route.ts` still
> writes a row to `client_tasks` (with `service_type='invoice_request'`)
> when a salesperson submits an invoice request from the contact card.
> That code path was already noted as dead-ish (the dashboard dialog
> writes directly to `invoice_requests`); it survives this removal
> because it's not part of the Desk feature itself. Touch it as a
> separate cleanup if you want.

## What was removed

| Path | Lines | Role |
| --- | --- | --- |
| `src/app/(dashboard)/super/desk/page.tsx` | 45 | Server page (data fetch + role gate) |
| `src/app/(dashboard)/super/desk/desk-client.tsx` | 928 | Client component (stats, table, add/edit/delete dialogs, inline notes) |
| `src/app/api/admin/desk/route.ts` | 138 | `GET` (list tasks) + `POST` (create) |
| `src/app/api/admin/desk/[id]/route.ts` | 171 | `PUT` (update) + `DELETE` |

The sidebar entry pointing to `/super/desk` was also removed from
`src/components/layouts/sidebar.tsx` (super_admin top-of-nav group).

## How to restore

1. Recreate the four files below at their original paths (the headings
   are the paths verbatim).
2. Re-add the sidebar entry — drop this back into the super_admin
   first nav group, right after Overview:

   ```tsx
   {
     label: "Desk",
     href: "/super/desk",
     icon: <ClipboardList className="h-4 w-4" />,
   },
   ```

   `ClipboardList` is already imported by the sidebar from
   `lucide-react`, so no import change is needed.
3. `client_tasks` table already exists; no migration step needed.

---

## File: `src/app/(dashboard)/super/desk/page.tsx`

```tsx
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { DeskClient } from "./desk-client";

export const dynamic = "force-dynamic";

interface ClientTask {
  id: string;
  contact_id: string | null;
  company_name: string;
  service_type: string;
  amount: number | null;
  paid_at: string | null;
  is_done: boolean;
  done_at: string | null;
  notes: string | null;
  needs_attention: boolean;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export default async function SuperDeskPage() {
  await requireRole("super_admin");
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from("client_tasks")
    .select("*")
    .order("created_at", { ascending: false });

  const allTasks: ClientTask[] = (tasks ?? []) as ClientTask[];

  const pendingInvoiceRequests = allTasks.filter(
    (t) => t.service_type === "invoice_request" && !t.is_done
  ).length;

  return (
    <DeskClient
      initialTasks={allTasks}
      pendingInvoiceRequests={pendingInvoiceRequests}
    />
  );
}
```

---

## File: `src/app/(dashboard)/super/desk/desk-client.tsx`

```tsx
"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Check,
  Clock,
  Trash2,
  Edit,
  AlertCircle,
  Search,
  DollarSign,
  ListChecks,
  Receipt,
  ChevronUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface ClientTask {
  id: string;
  contact_id: string | null;
  company_name: string;
  service_type: string;
  amount: number | null;
  paid_at: string | null;
  is_done: boolean;
  done_at: string | null;
  notes: string | null;
  needs_attention: boolean;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DeskClientProps {
  initialTasks: ClientTask[];
  pendingInvoiceRequests: number;
}

const SERVICE_TYPES = [
  { value: "website", label: "Website" },
  { value: "google_business_profile", label: "Google Business Profile" },
  { value: "backlinks", label: "Backlinks" },
  { value: "subpages", label: "Subpages" },
  { value: "email_setup", label: "Email Setup" },
  { value: "logo", label: "Logo" },
  { value: "facebook_ads", label: "Facebook Ads" },
  { value: "instagram", label: "Instagram" },
  { value: "google_ads", label: "Google Ads" },
  { value: "migration", label: "Migration" },
  { value: "invoice_request", label: "Invoice Request" },
  { value: "other", label: "Other" },
];

function getServiceLabel(value: string): string {
  return SERVICE_TYPES.find((s) => s.value === value)?.label ?? value;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAmount(amount: number | null): string {
  if (amount === null || amount === undefined) return "-";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function isThisWeek(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return date >= startOfWeek && date < endOfWeek;
}

export function DeskClient({
  initialTasks,
  pendingInvoiceRequests: initialInvoiceCount,
}: DeskClientProps) {
  const supabase = createClient();

  const [tasks, setTasks] = useState<ClientTask[]>(initialTasks);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add Task form state
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newServiceType, setNewServiceType] = useState("website");
  const [newAmount, setNewAmount] = useState("");
  const [newPaidAt, setNewPaidAt] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ClientTask | null>(null);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editServiceType, setEditServiceType] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPaidAt, setEditPaidAt] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editNeedsAttention, setEditNeedsAttention] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState<ClientTask | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Inline notes editing
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState("");

  // Stats
  const stats = useMemo(() => {
    const pending = tasks.filter((t) => !t.is_done).length;
    const completedThisWeek = tasks.filter(
      (t) => t.is_done && isThisWeek(t.done_at)
    ).length;
    const totalRevenue = tasks
      .filter((t) => t.is_done && t.amount !== null)
      .reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const invoiceRequests = tasks.filter(
      (t) => t.service_type === "invoice_request" && !t.is_done
    ).length;
    return { pending, completedThisWeek, totalRevenue, invoiceRequests };
  }, [tasks]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (activeTab === "pending") {
      result = result.filter((t) => !t.is_done);
    } else if (activeTab === "done") {
      result = result.filter((t) => t.is_done);
    } else if (activeTab === "attention") {
      result = result.filter((t) => t.needs_attention);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.company_name.toLowerCase().includes(q)
      );
    }

    return result;
  }, [tasks, activeTab, search]);

  // Add task
  const handleAddTask = useCallback(async () => {
    if (!newCompanyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        company_name: newCompanyName.trim(),
        service_type: newServiceType,
      };
      if (newAmount.trim()) {
        payload.amount = parseFloat(newAmount);
      }
      if (newPaidAt) {
        payload.paid_at = new Date(newPaidAt).toISOString();
      }
      if (newNotes.trim()) {
        payload.notes = newNotes.trim();
      }

      const { data, error } = await supabase
        .from("client_tasks")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      setTasks((prev) => [data as ClientTask, ...prev]);
      setNewCompanyName("");
      setNewServiceType("website");
      setNewAmount("");
      setNewPaidAt("");
      setNewNotes("");
      setFormOpen(false);
      toast.success("Task added");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add task";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [supabase, newCompanyName, newServiceType, newAmount, newPaidAt, newNotes]);

  // Toggle done
  const handleToggleDone = useCallback(
    async (task: ClientTask) => {
      const newDone = !task.is_done;
      const now = new Date().toISOString();

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, is_done: newDone, done_at: newDone ? now : null }
            : t
        )
      );

      try {
        const { error } = await supabase
          .from("client_tasks")
          .update({
            is_done: newDone,
            done_at: newDone ? now : null,
          })
          .eq("id", task.id);

        if (error) throw error;
        toast.success(newDone ? "Marked as done" : "Marked as pending");
      } catch (err: unknown) {
        // Revert
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, is_done: task.is_done, done_at: task.done_at }
              : t
          )
        );
        const message =
          err instanceof Error ? err.message : "Failed to update";
        toast.error(message);
      }
    },
    [supabase]
  );

  // Open edit dialog
  const openEditDialog = useCallback((task: ClientTask) => {
    setEditingTask(task);
    setEditCompanyName(task.company_name);
    setEditServiceType(task.service_type);
    setEditAmount(task.amount !== null ? String(task.amount) : "");
    setEditPaidAt(
      task.paid_at ? new Date(task.paid_at).toISOString().split("T")[0] : ""
    );
    setEditNotes(task.notes ?? "");
    setEditNeedsAttention(task.needs_attention);
    setEditDialogOpen(true);
  }, []);

  // Save edit
  const handleSaveEdit = useCallback(async () => {
    if (!editingTask) return;
    if (!editCompanyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    setEditSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        company_name: editCompanyName.trim(),
        service_type: editServiceType,
        amount: editAmount.trim() ? parseFloat(editAmount) : null,
        paid_at: editPaidAt
          ? new Date(editPaidAt).toISOString()
          : null,
        notes: editNotes.trim() || null,
        needs_attention: editNeedsAttention,
      };

      const { data, error } = await supabase
        .from("client_tasks")
        .update(payload)
        .eq("id", editingTask.id)
        .select("*")
        .single();

      if (error) throw error;

      setTasks((prev) =>
        prev.map((t) => (t.id === editingTask.id ? (data as ClientTask) : t))
      );
      setEditDialogOpen(false);
      setEditingTask(null);
      toast.success("Task updated");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to update task";
      toast.error(message);
    } finally {
      setEditSubmitting(false);
    }
  }, [
    supabase,
    editingTask,
    editCompanyName,
    editServiceType,
    editAmount,
    editPaidAt,
    editNotes,
    editNeedsAttention,
  ]);

  // Delete task
  const handleDelete = useCallback(async () => {
    if (!deletingTask) return;

    setDeleteSubmitting(true);
    try {
      const { error } = await supabase
        .from("client_tasks")
        .delete()
        .eq("id", deletingTask.id);

      if (error) throw error;

      setTasks((prev) => prev.filter((t) => t.id !== deletingTask.id));
      setDeleteDialogOpen(false);
      setDeletingTask(null);
      toast.success("Task deleted");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete task";
      toast.error(message);
    } finally {
      setDeleteSubmitting(false);
    }
  }, [supabase, deletingTask]);

  // Inline notes save
  const handleInlineNotesSave = useCallback(
    async (taskId: string) => {
      const trimmed = inlineEditValue.trim() || null;

      // Optimistic
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, notes: trimmed } : t))
      );
      setInlineEditId(null);

      try {
        const { error } = await supabase
          .from("client_tasks")
          .update({ notes: trimmed })
          .eq("id", taskId);

        if (error) throw error;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to save notes";
        toast.error(message);
      }
    },
    [supabase, inlineEditValue]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Management Desk</h1>
        <Button
          variant={formOpen ? "secondary" : "default"}
          onClick={() => setFormOpen(!formOpen)}
        >
          {formOpen ? (
            <>
              <ChevronUp className="mr-2 h-4 w-4" />
              Hide Form
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add Task
            </>
          )}
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Completed This Week
            </CardTitle>
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedThisWeek}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatAmount(stats.totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Invoice Requests
            </CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">
                {stats.invoiceRequests}
              </span>
              {stats.invoiceRequests > 0 && (
                <Badge variant="destructive" className="text-xs">
                  Pending
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Task form (collapsible) */}
      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Task</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name *</Label>
                <Input
                  id="company_name"
                  placeholder="e.g. Balkar s.r.o."
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service_type">Service Type</Label>
                <Select
                  value={newServiceType}
                  onValueChange={setNewServiceType}
                >
                  <SelectTrigger id="service_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (EUR)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paid_at">Paid Date</Label>
                <Input
                  id="paid_at"
                  type="date"
                  value={newPaidAt}
                  onChange={(e) => setNewPaidAt(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Optional notes..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleAddTask} disabled={submitting}>
                {submitting ? "Adding..." : "Add Task"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">
              All ({tasks.length})
            </TabsTrigger>
            <TabsTrigger value="pending">
              Pending ({tasks.filter((t) => !t.is_done).length})
            </TabsTrigger>
            <TabsTrigger value="done">
              Done ({tasks.filter((t) => t.is_done).length})
            </TabsTrigger>
            <TabsTrigger value="attention">
              <span className="flex items-center gap-1">
                Needs Attention
                {tasks.filter((t) => t.needs_attention).length > 0 && (
                  <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {tasks.filter((t) => t.needs_attention).length}
                  </span>
                )}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Tasks table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Company</TableHead>
                <TableHead className="w-[150px]">Service</TableHead>
                <TableHead className="w-[130px]">Amount</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {search.trim()
                      ? "No tasks match your search"
                      : "No tasks yet. Add one above."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTasks.map((task) => (
                  <TableRow
                    key={task.id}
                    className={
                      task.is_done
                        ? "bg-green-50/50 dark:bg-green-950/20"
                        : ""
                    }
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {task.needs_attention && (
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"
                            title="Needs attention"
                          />
                        )}
                        <span className="font-medium">
                          {task.company_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {getServiceLabel(task.service_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {task.amount !== null ? (
                        <div>
                          <div className="text-base font-semibold">
                            {formatAmount(task.amount)}
                          </div>
                          {task.paid_at && (
                            <div className="text-xs text-muted-foreground">
                              Paid {formatDate(task.paid_at)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => handleToggleDone(task)}
                        className="cursor-pointer"
                        title={
                          task.is_done
                            ? "Click to mark as pending"
                            : "Click to mark as done"
                        }
                      >
                        {task.is_done ? (
                          <Badge className="bg-green-600 hover:bg-green-700 text-white">
                            <Check className="mr-1 h-3 w-3" />
                            Done
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-yellow-500 text-yellow-700 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-950/30"
                          >
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      {inlineEditId === task.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={inlineEditValue}
                            onChange={(e) =>
                              setInlineEditValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleInlineNotesSave(task.id);
                              }
                              if (e.key === "Escape") {
                                setInlineEditId(null);
                              }
                            }}
                            className="h-7 text-sm"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => handleInlineNotesSave(task.id)}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => setInlineEditId(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="w-full cursor-pointer text-left text-sm text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setInlineEditId(task.id);
                            setInlineEditValue(task.notes ?? "");
                          }}
                          title="Click to edit notes"
                        >
                          {task.notes || (
                            <span className="italic opacity-50">
                              Click to add notes...
                            </span>
                          )}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => handleToggleDone(task)}
                          title={task.is_done ? "Mark pending" : "Mark done"}
                        >
                          <Check
                            className={`h-4 w-4 ${task.is_done ? "text-green-600" : "text-muted-foreground"}`}
                          />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => openEditDialog(task)}
                          title="Edit task"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                          onClick={() => {
                            setDeletingTask(task);
                            setDeleteDialogOpen(true);
                          }}
                          title="Delete task"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>
              Update the task details below.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit_company_name">Company Name *</Label>
              <Input
                id="edit_company_name"
                value={editCompanyName}
                onChange={(e) => setEditCompanyName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_service_type">Service Type</Label>
              <Select
                value={editServiceType}
                onValueChange={setEditServiceType}
              >
                <SelectTrigger id="edit_service_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_amount">Amount (EUR)</Label>
                <Input
                  id="edit_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_paid_at">Paid Date</Label>
                <Input
                  id="edit_paid_at"
                  type="date"
                  value={editPaidAt}
                  onChange={(e) => setEditPaidAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_notes">Notes</Label>
              <Textarea
                id="edit_notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={editNeedsAttention}
                className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                  editNeedsAttention
                    ? "border-red-500 bg-red-500 text-white"
                    : "border-muted-foreground"
                }`}
                onClick={() => setEditNeedsAttention(!editNeedsAttention)}
              >
                {editNeedsAttention && <Check className="h-3 w-3" />}
              </button>
              <Label className="flex items-center gap-1 cursor-pointer" onClick={() => setEditNeedsAttention(!editNeedsAttention)}>
                <AlertCircle className="h-4 w-4 text-red-500" />
                Needs Attention
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={editSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={editSubmitting}>
              {editSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the task for{" "}
              <strong>{deletingTask?.company_name}</strong>? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeletingTask(null);
              }}
              disabled={deleteSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

## File: `src/app/api/admin/desk/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * GET /api/admin/desk
 * Fetch all client tasks. Only super_admin and administrator.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string;
  if (!["super_admin", "administrator"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: tasks, error } = await admin
    .from("client_tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: tasks ?? [] });
}

/**
 * POST /api/admin/desk
 * Create a new client task. Only super_admin and administrator.
 * Body: { company_name, service_type, amount?, paid_at?, notes?, assigned_to?, needs_attention? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string;
  if (!["super_admin", "administrator"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const {
    company_name,
    service_type,
    amount,
    paid_at,
    notes,
    assigned_to,
    needs_attention,
  } = body as {
    company_name: string;
    service_type: string;
    amount?: number | null;
    paid_at?: string | null;
    notes?: string | null;
    assigned_to?: string | null;
    needs_attention?: boolean;
  };

  if (!company_name || !company_name.trim()) {
    return NextResponse.json(
      { error: "company_name is required" },
      { status: 400 }
    );
  }

  if (!service_type || !service_type.trim()) {
    return NextResponse.json(
      { error: "service_type is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const payload: Record<string, unknown> = {
    company_name: company_name.trim(),
    service_type: service_type.trim(),
    created_by: user.id,
  };

  if (amount !== undefined && amount !== null) {
    payload.amount = amount;
  }
  if (paid_at) {
    payload.paid_at = paid_at;
  }
  if (notes && notes.trim()) {
    payload.notes = notes.trim();
  }
  if (assigned_to) {
    payload.assigned_to = assigned_to;
  }
  if (needs_attention !== undefined) {
    payload.needs_attention = needs_attention;
  }

  const { data: task, error } = await admin
    .from("client_tasks")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "create_client_task",
    entityType: "client_task",
    entityId: task.id,
    details: {
      company_name: company_name.trim(),
      service_type: service_type.trim(),
      amount: amount ?? null,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
```

---

## File: `src/app/api/admin/desk/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * PUT /api/admin/desk/[id]
 * Update a client task. Only super_admin and administrator.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string;
  if (!["super_admin", "administrator"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const {
    company_name,
    service_type,
    amount,
    paid_at,
    is_done,
    done_at,
    notes,
    needs_attention,
    assigned_to,
  } = body as {
    company_name?: string;
    service_type?: string;
    amount?: number | null;
    paid_at?: string | null;
    is_done?: boolean;
    done_at?: string | null;
    notes?: string | null;
    needs_attention?: boolean;
    assigned_to?: string | null;
  };

  const admin = createAdminClient();

  // Verify task exists
  const { data: existing, error: fetchErr } = await admin
    .from("client_tasks")
    .select("id")
    .eq("id", taskId)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const payload: Record<string, unknown> = {};

  if (company_name !== undefined) {
    if (!company_name.trim()) {
      return NextResponse.json(
        { error: "company_name cannot be empty" },
        { status: 400 }
      );
    }
    payload.company_name = company_name.trim();
  }
  if (service_type !== undefined) payload.service_type = service_type;
  if (amount !== undefined) payload.amount = amount;
  if (paid_at !== undefined) payload.paid_at = paid_at;
  if (is_done !== undefined) payload.is_done = is_done;
  if (done_at !== undefined) payload.done_at = done_at;
  if (notes !== undefined) payload.notes = notes;
  if (needs_attention !== undefined) payload.needs_attention = needs_attention;
  if (assigned_to !== undefined) payload.assigned_to = assigned_to;

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  const { data: task, error } = await admin
    .from("client_tasks")
    .update(payload)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "update_client_task",
    entityType: "client_task",
    entityId: taskId,
    details: payload,
  });

  return NextResponse.json({ task });
}

/**
 * DELETE /api/admin/desk/[id]
 * Delete a client task. Only super_admin and administrator.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string;
  if (!["super_admin", "administrator"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Verify task exists and get details for audit
  const { data: existing, error: fetchErr } = await admin
    .from("client_tasks")
    .select("id, company_name, service_type")
    .eq("id", taskId)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const { error } = await admin
    .from("client_tasks")
    .delete()
    .eq("id", taskId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "delete_client_task",
    entityType: "client_task",
    entityId: taskId,
    details: {
      company_name: existing.company_name,
      service_type: existing.service_type,
    },
  });

  return NextResponse.json({ success: true });
}
```
