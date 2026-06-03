"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/email/rich-text-editor";
import { toast } from "sonner";
import { Send, Loader2, Mail, Save, Trash2, Pencil, Check, X } from "lucide-react";


interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
}

interface FollowUpEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId?: string;
  contactId?: string;
  companyName: string;
  contactEmail: string | null;
  initialSubject?: string;
  initialBody?: string;
}

export function FollowUpEmailDialog({
  open,
  onOpenChange,
  proposalId,
  contactId,
  companyName,
  contactEmail,
  initialSubject,
  initialBody,
}: FollowUpEmailDialogProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState(initialSubject || "");
  const [bodyHtml, setBodyHtml] = useState(initialBody || "<p></p>");
  const [editorKey, setEditorKey] = useState(0);

  // Update when initialSubject/initialBody changes (template selection from parent)
  useEffect(() => {
    if (open && initialSubject) { setSubject(initialSubject); }
    if (open && initialBody) { setBodyHtml(initialBody); setEditorKey(k => k + 1); }
  }, [open, initialSubject, initialBody]);

  // Templates
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Whether the current selection is a saved template (not "none")
  const isUsingSavedTemplate = selectedTemplateId !== null && selectedTemplateId !== "none";

  // Save as template
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Rename template
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState("");

  useEffect(() => {
    if (open) {
      fetch("/api/email-templates?category=follow_up")
        .then((r) => r.json())
        .then((data) => setTemplates(data.templates ?? []))
        .catch(() => {});
    }
  }, [open]);

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    // Reset save-as-template when switching to an existing template
    if (templateId !== "none") {
      setSaveAsTemplate(false);
    }
    setRenaming(false);

    if (templateId === "none") {
      setSubject("");
      setBodyHtml("<p></p>");
      setEditorKey((k) => k + 1);
      return;
    }
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setSubject(tpl.subject.replace("{company}", companyName));
    setBodyHtml(tpl.body_html);
    setEditorKey((k) => k + 1);
  }

  async function deleteTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (!confirm(`Delete template "${tpl.name}"?`)) return;

    try {
      const res = await fetch(`/api/email-templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to delete the template");
        return;
      }
      toast.success("Template deleted");
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      // If this was the selected template, reset to none
      if (selectedTemplateId === templateId) {
        setSelectedTemplateId("none");
        setSubject("");
        setBodyHtml("<p></p>");
        setEditorKey((k) => k + 1);
      }
    } catch {
      toast.error("Network error");
    }
  }

  async function updateTemplate() {
    if (!selectedTemplateId) return;
    try {
      const res = await fetch(`/api/email-templates/${selectedTemplateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: renameTo.trim() || undefined,
          subject: subject,
          body_html: bodyHtml,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to save the template");
        return;
      }
      toast.success("Template saved");
      setTemplates((prev) =>
        prev.map((t) => (t.id === selectedTemplateId ? { ...t, name: renameTo.trim() || t.name, subject, body_html: bodyHtml } : t))
      );
      setRenaming(false);
    } catch {
      toast.error("Network error");
    }
  }

  async function handleSend() {
    if (!bodyHtml.trim() || bodyHtml === "<p></p>") {
      toast.error("Write the email content");
      return;
    }
    if (!subject.trim()) {
      toast.error("Fill in the email subject");
      return;
    }
    if (!contactEmail) {
      toast.error("The contact has no email address");
      return;
    }

    setSending(true);
    try {
      // Save as template first if requested
      if (saveAsTemplate && templateName.trim()) {
        setSavingTemplate(true);
        await fetch("/api/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            subject: subject,
            body_html: bodyHtml,
            category: "follow_up",
          }),
        });
        setSavingTemplate(false);
      }

      let res: Response;
      if (contactId) {
        // Send via contacts API (from dashboard broad database)
        res = await fetch("/api/contacts/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_id: contactId,
            subject: subject,
            body_html: bodyHtml,
          }),
        });
      } else {
        // Send via proposals API (from contact detail)
        res = await fetch(`/api/proposals/${proposalId}/send-follow-up`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: subject,
            body_html: bodyHtml,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send the email");
        return;
      }

      toast.success(`Email sent to ${contactEmail}`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email — {companyName}
          </DialogTitle>
          <DialogDescription>
            Send to{" "}
            <span className="font-medium text-foreground">{contactEmail || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Template picker */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Template</Label>
            <div className="flex items-center gap-2">
              <Select value={selectedTemplateId ?? undefined} onValueChange={applyTemplate}>
                <SelectTrigger className="h-8 text-sm flex-1">
                  <SelectValue placeholder="Select a template…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isUsingSavedTemplate && !renaming && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 shrink-0 text-xs gap-1"
                    title="Save changes to the template"
                    onClick={() => {
                      const tpl = templates.find((t) => t.id === selectedTemplateId);
                      setRenameTo(tpl?.name || "");
                      updateTemplate();
                    }}
                  >
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    title="Rename template"
                    onClick={() => {
                      const tpl = templates.find((t) => t.id === selectedTemplateId);
                      setRenameTo(tpl?.name || "");
                      setRenaming(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive shrink-0"
                    title="Delete template"
                    onClick={() => deleteTemplate(selectedTemplateId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
            {renaming && isUsingSavedTemplate && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Input
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.target.value)}
                  placeholder="New template name…"
                  className="h-7 text-sm flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updateTemplate();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={updateTemplate}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setRenaming(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label htmlFor="fu-subject" className="text-xs">Subject</Label>
            <Input
              id="fu-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* Rich text body */}
          <div className="space-y-1.5">
            <Label className="text-xs">Email content</Label>
            <RichTextEditor
              key={editorKey}
              content={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Write a follow-up email…"
            />
          </div>

          {/* Save as template */}
          <div className={`flex items-start gap-2 rounded-md border bg-muted/30 p-3 ${isUsingSavedTemplate ? "opacity-50" : ""}`}>
            <Checkbox
              id="save-tpl"
              checked={saveAsTemplate}
              onCheckedChange={(v) => setSaveAsTemplate(v === true)}
              disabled={isUsingSavedTemplate}
              className="mt-0.5"
            />
            <div className="flex-1 space-y-1.5">
              <label htmlFor="save-tpl" className={`text-sm ${isUsingSavedTemplate ? "cursor-not-allowed" : "cursor-pointer"}`}>
                Save as template
                {isUsingSavedTemplate && (
                  <span className="block text-xs text-muted-foreground mt-0.5">You're using an existing template</span>
                )}
              </label>
              {saveAsTemplate && (
                <Input
                  placeholder="Template name…"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="h-7 text-sm"
                />
              )}
            </div>
          </div>

          {!contactEmail && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
              The contact has no email address.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !contactEmail} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Sending..." : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
