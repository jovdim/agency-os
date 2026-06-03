"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/email/rich-text-editor";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  FileText,
  Mail,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  category: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  proposal: "Proposal",
  follow_up: "Follow-up",
};

const CATEGORY_STYLE: Record<string, string> = {
  proposal: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  follow_up: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export function TemplatesClient({
  templates: initialTemplates,
}: {
  templates: EmailTemplate[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editDialog, setEditDialog] = useState<EmailTemplate | "new" | null>(null);

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Templates
          </h1>
          <p className="text-sm text-muted-foreground">
            {initialTemplates.length} template{initialTemplates.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" onClick={() => setEditDialog("new")} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      {/* Table */}
      {initialTemplates.length === 0 ? (
        <div className="rounded-md border py-16 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground mb-3">No email templates yet.</p>
          <Button size="sm" variant="outline" onClick={() => setEditDialog("new")} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Create your first template
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 text-left font-medium min-w-44">Name</th>
                <th className="py-2 px-3 text-left font-medium min-w-44">Subject</th>
                <th className="py-2 px-3 text-left font-medium min-w-24">Type</th>
                <th className="py-2 px-3 text-right font-medium min-w-28">Updated</th>
                <th className="py-2 px-3 text-center font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialTemplates.map((t) => (
                <tr
                  key={t.id}
                  data-interactive="true"
                  className="border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => setEditDialog(t)}
                >
                  <td className="py-2 px-3">
                    <span className="font-medium">{t.name}</span>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground truncate max-w-44">
                    {t.subject || "—"}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_STYLE[t.category] ?? "bg-muted text-muted-foreground"}`}>
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                  </td>
                  <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit" onClick={() => setEditDialog(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <DeleteButton templateId={t.id} templateName={t.name} onDeleted={() => startTransition(() => router.refresh())} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit/Create Dialog */}
      {editDialog && (
        <TemplateEditorDialog
          template={editDialog === "new" ? null : editDialog}
          open={!!editDialog}
          onOpenChange={(open) => { if (!open) setEditDialog(null); }}
          onSaved={() => {
            setEditDialog(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

// ── Template Editor Dialog ──────────────────────────────────────────────────

function TemplateEditorDialog({
  template,
  open,
  onOpenChange,
  onSaved,
}: {
  template: EmailTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(template?.name || "");
  const [subject, setSubject] = useState(template?.subject || "");
  const [bodyHtml, setBodyHtml] = useState(template?.body_html || "<p></p>");
  const [category, setCategory] = useState(template?.category || "follow_up");

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }

    setSaving(true);
    try {
      const url = template
        ? `/api/email-templates/${template.id}`
        : "/api/email-templates";
      const method = template ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          body_html: bodyHtml,
          category,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to save template");
        return;
      }

      toast.success(template ? "Template updated" : "Template created");
      onSaved();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Template" : "New Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Follow-up day 7"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proposal">Proposal</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject line… (use {company} for company name)"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Body</Label>
            <RichTextEditor
              content={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Write template content…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Button ───────────────────────────────────────────────────────────

function DeleteButton({
  templateId,
  templateName,
  onDeleted,
}: {
  templateId: string;
  templateName: string;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${templateName}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/email-templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to delete");
        return;
      }
      toast.success("Template deleted");
      onDeleted();
    } catch {
      toast.error("Network error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
      title="Delete"
      disabled={deleting}
      onClick={handleDelete}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
