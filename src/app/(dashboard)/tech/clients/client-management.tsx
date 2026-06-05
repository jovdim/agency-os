"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Globe, PencilSimple as Pencil, Key as KeyRound, CircleNotch as Loader2, Copy, Check, User, Buildings as Building2, Phone, Envelope as Mail, CalendarBlank as Calendar, Link as LinkIcon, Coins, ArrowsClockwise as RefreshCw, PaperPlaneTilt as Send, Eye } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface ClientProfile {
  id: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

interface LinkedContact {
  id: string;
  email: string | null;
  contact_person: string | null;
  company_name: string | null;
  phone: string | null;
  industry: string | null;
  town: string | null;
}

interface ClientSite {
  id: string;
  name: string;
  status: string;
  credits: number;
  site_url: string | null;
  codebase_link: string | null;
  proposalId: string | null;
}

export function ClientManagement({
  clients,
  contactsByUserId,
  clientSiteInfo,
}: {
  clients: ClientProfile[];
  contactsByUserId: Record<string, LinkedContact>;
  clientSiteInfo: Record<string, ClientSite>;
}) {
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "password" | "resync" | "credits" | "send_email">("view");
  const [saving, setSaving] = useState(false);

  // Edit form
  const [editForm, setEditForm] = useState({
    full_name: "",
    company_name: "",
    phone: "",
    site_url: "",
    codebase_link: "",
  });

  // Password form
  const [newPassword, setNewPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-sync content.json
  const [resyncJson, setResyncJson] = useState("");
  const [resyncError, setResyncError] = useState("");
  const [resyncSuccess, setResyncSuccess] = useState<number | null>(null);

  // Grant credits — euro amount, must be a multiple of PUBLISH_COST_EUR.
  // Default to one publish worth so the dialog opens "ready to grant 1
  // publish" without extra clicks. Buttons step in publish-cost units.
  // `grantMode` toggles between adding and subtracting; the value sent
  // to the API is signed accordingly.
  const [grantAmount, setGrantAmount] = useState(12.5);
  const [grantMode, setGrantMode] = useState<"add" | "subtract">("add");
  const [grantNote, setGrantNote] = useState("");
  const [grantSuccess, setGrantSuccess] = useState(false);

  // Send email
  const [emailCustomMsg, setEmailCustomMsg] = useState("");
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [loadingEmailPreview, setLoadingEmailPreview] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailPassword, setEmailPassword] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailLoginEmail, setEmailLoginEmail] = useState("");

  function openClient(client: ClientProfile) {
    setSelectedClient(client);
    setMode("view");
    const site = clientSiteInfo[client.id];
    setEditForm({
      full_name: client.full_name || "",
      company_name: client.company_name || "",
      phone: client.phone || "",
      site_url: site?.site_url || "",
      codebase_link: site?.codebase_link || "",
    });
    setNewPassword("");
    setPasswordChanged(false);
  }

  function closeDialog() {
    setSelectedClient(null);
    setMode("view");
    setPasswordChanged(false);
    setCopied(false);
    setResyncJson("");
    setResyncError("");
    setResyncSuccess(null);
    setGrantAmount(1);
    setGrantNote("");
    setGrantSuccess(false);
    setEmailCustomMsg("");
    setEmailPreviewHtml("");
    setEmailSent(false);
    setEmailPassword("");
    setEmailTo("");
    setEmailLoginEmail("");
  }

  async function handleSaveEdit() {
    if (!selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: editForm.full_name || null,
          company_name: editForm.company_name || null,
          phone: editForm.phone || null,
          site_url: editForm.site_url || null,
          codebase_link: editForm.codebase_link || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update");
        return;
      }
      toast.success("Client updated");
      setMode("view");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!selectedClient || !newPassword) return;
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to change password");
        return;
      }
      setPasswordChanged(true);
      toast.success("Password changed");
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !selectedClient.is_active }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update status");
        return;
      }
      toast.success(selectedClient.is_active ? "Client deactivated" : "Client activated");
      closeDialog();
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleGrantCredits() {
    if (!selectedClient || grantAmount <= 0) return;
    const site = clientSiteInfo[selectedClient.id];
    if (!site) {
      toast.error("No site found for this client");
      return;
    }
    // Sign the amount based on add/subtract mode. The API takes a signed
    // delta — the same endpoint handles both directions.
    const signedAmount = grantMode === "subtract" ? -grantAmount : grantAmount;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${selectedClient.id}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: signedAmount, note: grantNote || null, site_id: site.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update credits");
        return;
      }
      setGrantSuccess(true);
      toast.success(
        grantMode === "subtract"
          ? `Deducted $${grantAmount.toFixed(2)}`
          : `Granted $${grantAmount.toFixed(2)}`,
      );
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleResyncContent() {
    if (!selectedClient || !resyncJson.trim()) return;
    setResyncError("");
    setSaving(true);
    try {
      let parsed = JSON.parse(resyncJson.trim());
      // Accept both { sections: [...] } and direct [...]
      if (parsed.sections && Array.isArray(parsed.sections)) {
        parsed = parsed.sections;
      }
      if (!Array.isArray(parsed)) {
        setResyncError("Expected an array of sections or an object with a 'sections' key");
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/admin/clients/${selectedClient.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResyncError(data.error || "Failed to sync");
        return;
      }
      setResyncSuccess(data.sections_count);
      toast.success(`Synced ${data.sections_count} sections`);
      router.refresh();
    } catch (e) {
      setResyncError(e instanceof SyntaxError ? "Invalid JSON format" : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function loadEmailPreview() {
    if (!selectedClient) return;
    const site = clientSiteInfo[selectedClient.id];
    setLoadingEmailPreview(true);
    try {
      const params = new URLSearchParams({
        full_name: selectedClient.full_name || "",
        login_email: emailLoginEmail || emailTo || "",
        login_password: emailPassword || "********",
        ...(selectedClient.company_name && { company_name: selectedClient.company_name }),
        ...(site?.site_url && { site_url: site.site_url }),
        ...(emailCustomMsg && { custom_message: emailCustomMsg }),
      });
      const res = await fetch(`/api/admin/clients/send-welcome?${params}`);
      if (res.ok) {
        setEmailPreviewHtml(await res.text());
      }
    } catch { /* ignore */ }
    setLoadingEmailPreview(false);
  }

  async function handleSendEmail() {
    if (!selectedClient) return;
    const site = clientSiteInfo[selectedClient.id];
    if (!emailTo) {
      toast.error("Enter the client's email address");
      return;
    }
    if (!emailPassword) {
      toast.error("Enter the client's password to include in the email");
      return;
    }
    setSendingEmail(true);
    try {
      const res = await fetch("/api/admin/clients/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          full_name: selectedClient.full_name || "",
          company_name: selectedClient.company_name || undefined,
          login_email: emailLoginEmail || emailTo,
          login_password: emailPassword,
          site_url: site?.site_url || undefined,
          site_name: site?.name || undefined,
          custom_message: emailCustomMsg || undefined,
        }),
      });
      if (res.ok) {
        setEmailSent(true);
        toast.success("Email sent!");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to send email");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSendingEmail(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (clients.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No clients yet. Create one manually or auto-create when a proposal is accepted.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {clients.map((client) => {
          const contact = contactsByUserId[client.id];
          const site = clientSiteInfo[client.id];
          const email = contact?.email;

          return (
            <button
              key={client.id}
              onClick={() => openClient(client)}
              className="w-full flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-muted/40 transition-colors text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-medium truncate">{client.full_name || "Unnamed"}</p>
                  {contact && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
                      <LinkIcon className="h-2.5 w-2.5" />
                      Linked
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {client.company_name || "No company"}
                  {email && ` · ${email}`}
                  {" · "}
                  {formatDistanceToNow(new Date(client.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4 shrink-0">
                {site ? (
                  <Badge variant={site.status === "live" ? "default" : "secondary"} className="text-[11px]">
                    {site.status === "live" ? "Live" : site.status}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">No site</span>
                )}
                <Badge variant={client.is_active ? "default" : "secondary"}>
                  {client.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>

      {/* Client Detail Dialog */}
      <Dialog open={!!selectedClient} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className={`overflow-hidden ${mode === "send_email" ? "sm:max-w-lg" : "sm:max-w-md"}`}>
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle className="truncate">
              {selectedClient?.full_name || "Client"}
            </DialogTitle>
          </DialogHeader>

          {selectedClient && mode === "view" && (
            <div className="space-y-4">
              {/* Info */}
              <div className="space-y-2">
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Name" value={selectedClient.full_name} />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={selectedClient.company_name} />
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={selectedClient.phone} />
                {contactsByUserId[selectedClient.id]?.email && (
                  <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contactsByUserId[selectedClient.id].email} />
                )}
                <InfoRow
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label="Created"
                  value={formatDistanceToNow(new Date(selectedClient.created_at), { addSuffix: true })}
                />
              </div>

              {/* Site + Credits */}
              {clientSiteInfo[selectedClient.id] ? (
                <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Website</p>
                      <p className="text-sm font-medium truncate">{clientSiteInfo[selectedClient.id].name}</p>
                    </div>
                    <Badge variant={clientSiteInfo[selectedClient.id].status === "live" ? "default" : "secondary"} className="shrink-0 ml-2">
                      {clientSiteInfo[selectedClient.id].status}
                    </Badge>
                  </div>
                  {clientSiteInfo[selectedClient.id].site_url && (
                    <div className="flex items-center gap-1.5 text-sm min-w-0">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <a
                        href={clientSiteInfo[selectedClient.id].site_url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline truncate"
                      >
                        {clientSiteInfo[selectedClient.id].site_url!.replace(/^https?:\/\//, "")}
                      </a>
                    </div>
                  )}
                  {clientSiteInfo[selectedClient.id].codebase_link && (
                    <div className="flex items-center gap-1.5 text-sm min-w-0">
                      <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <a
                        href={clientSiteInfo[selectedClient.id].codebase_link!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline truncate"
                      >
                        {clientSiteInfo[selectedClient.id].codebase_link!.replace(/^https?:\/\/github\.com\//, "")}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-sm">
                    <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Balance:</span>
                    <span className="font-medium">${clientSiteInfo[selectedClient.id].credits.toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => {
                        setMode("resync");
                        setResyncJson("");
                        setResyncError("");
                        setResyncSuccess(null);
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Re-sync
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => {
                        setMode("credits");
                        setGrantAmount(12.5);
                        setGrantMode("add");
                        setGrantNote("");
                        setGrantSuccess(false);
                      }}
                    >
                      <Coins className="h-3 w-3 mr-1" />
                      Credits
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border bg-muted/30 px-3 py-2.5">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Website</p>
                  <p className="text-xs text-muted-foreground mt-1">No site assigned yet</p>
                </div>
              )}

              {/* Linked contact */}
              {contactsByUserId[selectedClient.id] && (
                <div className="rounded-md border bg-muted/30 px-3 py-2.5">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Linked Contact</p>
                  <p className="text-sm truncate">
                    {contactsByUserId[selectedClient.id].contact_person || contactsByUserId[selectedClient.id].company_name}
                  </p>
                  {contactsByUserId[selectedClient.id].industry && (
                    <p className="text-xs text-muted-foreground truncate">{contactsByUserId[selectedClient.id].industry} · {contactsByUserId[selectedClient.id].town}</p>
                  )}
                </div>
              )}

              {/* Status */}
              <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                <div>
                  <p className="text-xs text-muted-foreground">Account Status</p>
                  <Badge variant={selectedClient.is_active ? "default" : "secondary"} className="mt-1">
                    {selectedClient.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant={selectedClient.is_active ? "destructive" : "default"}
                  onClick={handleToggleActive}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selectedClient.is_active ? "Deactivate" : "Activate"}
                </Button>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => setMode("edit")}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => {
                    setMode("password");
                    setNewPassword("");
                    setPasswordChanged(false);
                  }}
                >
                  <KeyRound className="h-3 w-3 mr-1" />
                  Password
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => {
                    setMode("send_email");
                    setEmailCustomMsg("");
                    setEmailPreviewHtml("");
                    setEmailSent(false);
                    setEmailPassword("");
                    const contactEmail = contactsByUserId[selectedClient.id]?.email || "";
                    setEmailTo(contactEmail);
                    setEmailLoginEmail(contactEmail);
                  }}
                >
                  <Mail className="h-3 w-3 mr-1" />
                  Email
                </Button>
              </div>
            </div>
          )}

          {selectedClient && mode === "edit" && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Full Name</label>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Company Name</label>
                <Input
                  value={editForm.company_name}
                  onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>
              {clientSiteInfo[selectedClient.id] && (
                <>
                  <div className="pt-2 border-t">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Website</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Live Website URL</label>
                    <Input
                      type="url"
                      value={editForm.site_url}
                      onChange={(e) => setEditForm({ ...editForm, site_url: e.target.value })}
                      placeholder="https://company.2dni.sk"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Codebase Link</label>
                    <Input
                      type="url"
                      value={editForm.codebase_link}
                      onChange={(e) => setEditForm({ ...editForm, codebase_link: e.target.value })}
                      placeholder="https://github.com/..."
                    />
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Save Changes
                </Button>
                <Button size="sm" variant="outline" onClick={() => setMode("view")} className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {selectedClient && mode === "password" && (
            <div className="space-y-4">
              {!passwordChanged ? (
                <>
                  <div>
                    <label className="text-sm font-medium">New Password</label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter or generate password"
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-9"
                        onClick={() => {
                          const chars = "abcdefghijkmnpqrstuvwxyz23456789";
                          let pw = "";
                          for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
                          setNewPassword(pw);
                        }}
                      >
                        Generate
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      The password will be visible so you can share it with the client.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleChangePassword}
                      disabled={saving || !newPassword}
                      className="flex-1"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <KeyRound className="h-3.5 w-3.5 mr-1.5" />}
                      Change Password
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMode("view")} className="flex-1">
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-2">
                      Password changed successfully
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-white dark:bg-gray-900 px-2 py-1 text-sm font-mono border truncate">
                        {newPassword}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={() => copyToClipboard(newPassword)}
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setMode("view")} className="w-full">
                    Done
                  </Button>
                </div>
              )}
            </div>
          )}
          {selectedClient && mode === "resync" && (
            <div className="space-y-4">
              {resyncSuccess !== null ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      Successfully synced {resyncSuccess} sections
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The client will now see the updated sections in their editor.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setMode("view")} className="w-full">
                    Done
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium">Paste updated content.json</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      This will replace ALL existing sections for this client&apos;s site.
                    </p>
                    <textarea
                      className="w-full h-40 rounded-lg border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder='{ "sections": [ ... ] }'
                      value={resyncJson}
                      onChange={(e) => setResyncJson(e.target.value)}
                    />
                    {resyncError && (
                      <p className="text-xs text-destructive mt-1">{resyncError}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleResyncContent}
                      disabled={saving || !resyncJson.trim()}
                      className="flex-1"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                      Sync Sections
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={async () => {
                        // Try to fetch content.json from proposal's content_overrides
                        try {
                          const siteInfo = clientSiteInfo[selectedClient.id];
                          if (!siteInfo?.proposalId) {
                            setResyncError("No proposal linked to this client");
                            return;
                          }
                          const res = await fetch(`/api/proposals/${siteInfo.proposalId}`);
                          const data = await res.json();
                          if (data.content_overrides) {
                            setResyncJson(JSON.stringify(data.content_overrides, null, 2));
                            toast.success("Content.json loaded from proposal");
                          } else {
                            setResyncError("No content.json saved on this proposal. Upload files first.");
                          }
                        } catch {
                          setResyncError("Failed to fetch content.json");
                        }
                      }}
                    >
                      Fetch from Proposal
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMode("view")}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {selectedClient && mode === "credits" && (
            <div className="space-y-4">
              {grantSuccess ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      {grantMode === "subtract" ? "Deducted" : "Granted"} ${grantAmount.toFixed(2)} successfully
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setMode("view")} className="w-full">
                    Done
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {/* Add / Subtract toggle. Only the magnitude is set
                        below; this picks the sign. */}
                    <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/40 p-1">
                      <button
                        type="button"
                        onClick={() => setGrantMode("add")}
                        className={`text-xs font-medium rounded-sm px-2 py-1.5 transition-colors ${
                          grantMode === "add"
                            ? "bg-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        + Add credit
                      </button>
                      <button
                        type="button"
                        onClick={() => setGrantMode("subtract")}
                        className={`text-xs font-medium rounded-sm px-2 py-1.5 transition-colors ${
                          grantMode === "subtract"
                            ? "bg-background shadow-sm text-destructive"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        − Deduct credit
                      </button>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Amount ($)</label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Each publish costs $12.50. Pick how many publishes
                        worth to {grantMode === "subtract" ? "remove" : "grant"}.
                      </p>
                      {/* Quick-pick buttons in publish-cost units. Plus/minus
                          step by $12.50 for fine-grained control. */}
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() =>
                            setGrantAmount((a) =>
                              Number(Math.max(12.5, a - 12.5).toFixed(2)),
                            )
                          }
                          disabled={grantAmount <= 12.5}
                          aria-label="Decrease by $12.50"
                        >
                          −
                        </Button>
                        <div className="flex-1 rounded-md border bg-muted/30 px-3 py-1.5 text-center">
                          <p className="text-base font-semibold leading-tight">
                            ${grantAmount.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-tight">
                            {Math.round(grantAmount / 12.5)} publish
                            {Math.round(grantAmount / 12.5) === 1 ? "" : "es"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() =>
                            setGrantAmount((a) =>
                              Number(Math.min(1000, a + 12.5).toFixed(2)),
                            )
                          }
                          disabled={grantAmount >= 1000}
                          aria-label="Increase by $12.50"
                        >
                          +
                        </Button>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 mt-2">
                        {[12.5, 25, 50, 125].map((preset) => (
                          <Button
                            key={preset}
                            type="button"
                            size="sm"
                            variant={grantAmount === preset ? "default" : "outline"}
                            className="h-7 text-xs px-2"
                            onClick={() => setGrantAmount(preset)}
                          >
                            ${preset.toFixed(2)}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Note (optional)</label>
                      <Input
                        value={grantNote}
                        onChange={(e) => setGrantNote(e.target.value)}
                        placeholder="e.g. Bonus credits, initial setup..."
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={grantMode === "subtract" ? "destructive" : "default"}
                      onClick={handleGrantCredits}
                      disabled={saving || grantAmount <= 0}
                      className="flex-1"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Coins className="h-3.5 w-3.5 mr-1.5" />}
                      {grantMode === "subtract"
                        ? `Deduct $${grantAmount.toFixed(2)}`
                        : `Grant $${grantAmount.toFixed(2)}`}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMode("view")} className="flex-1">
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {selectedClient && mode === "send_email" && (() => {
            return (
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                {emailSent && (
                  <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      Email sent to {emailTo}
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">Send To *</label>
                  <Input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="client@example.com"
                    className="mt-1"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Where the welcome email will be delivered.</p>
                </div>

                <div>
                  <label className="text-sm font-medium">Login Email *</label>
                  <Input
                    type="email"
                    value={emailLoginEmail}
                    onChange={(e) => setEmailLoginEmail(e.target.value)}
                    placeholder="client@example.com"
                    className="mt-1"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">The email shown in the email — client uses this to log in.</p>
                </div>

                <div>
                  <label className="text-sm font-medium">Client Password *</label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      type="text"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      placeholder="Enter current or new password"
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-9"
                      onClick={() => {
                        const chars = "abcdefghijkmnpqrstuvwxyz23456789";
                        let pw = "";
                        for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
                        setEmailPassword(pw);
                      }}
                    >
                      Generate
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    This password will be shown in the email. Use current password or generate a new one.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Custom Message (optional)</label>
                  <textarea
                    className="w-full h-16 mt-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Add a personal note..."
                    value={emailCustomMsg}
                    onChange={(e) => setEmailCustomMsg(e.target.value)}
                  />
                </div>

                {/* Preview */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={loadEmailPreview}
                  disabled={loadingEmailPreview}
                >
                  {loadingEmailPreview ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {emailPreviewHtml ? "Refresh Preview" : "Preview Email"}
                </Button>

                {emailPreviewHtml && (
                  <div className="rounded-lg border overflow-hidden">
                    <iframe
                      srcDoc={emailPreviewHtml}
                      className="w-full bg-white"
                      style={{ height: 520, border: "none" }}
                      title="Email preview"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={handleSendEmail}
                    disabled={sendingEmail || !emailTo || !emailPassword}
                  >
                    {sendingEmail ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : emailSent ? (
                      <RefreshCw className="h-3.5 w-3.5" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {sendingEmail ? "Sending..." : emailSent ? "Send Again" : "Send Email"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMode("view")} className="flex-1">
                    {emailSent ? "Done" : "Cancel"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="font-medium truncate min-w-0">{value || "—"}</span>
    </div>
  );
}
