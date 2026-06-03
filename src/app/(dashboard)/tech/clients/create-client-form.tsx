"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  UserPlus,
  Loader2,
  CheckCircle,
  Copy,
  Check,
  Search,
  X,
  Mail,
  Send,
  Eye,
  RefreshCw,
} from "lucide-react";

export function TechCreateClientForm({ initialContactId }: { initialContactId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!initialContactId);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    company_name: "",
    phone: "",
    business_email: "",
    site_name: "",
    site_url: "",
    codebase_link: "",
    initial_credits: 50,
  });

  // Success state
  const [success, setSuccess] = useState<{
    client: { name: string; email: string; password: string };
    site: {
      name: string;
      slug: string;
      site_url: string;
      codebase_link?: string | null;
      credits: number;
    };
    site_id: string;
  } | null>(null);

  const [copied, setCopied] = useState<string | null>(null);

  // Email state
  const [customMessage, setCustomMessage] = useState("");
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Deployment warnings (shown when auto-fill can't find live site / codebase)
  const [deploymentWarnings, setDeploymentWarnings] = useState<{ site_url?: boolean; codebase_link?: boolean }>({});

  // Contact search
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<{
    id: string;
    company_name: string | null;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    business_email?: string | null;
  }[]>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const contactDropdownRef = useRef<HTMLDivElement>(null);

  // Auto-load contact when initialContactId is provided (from "Create" button)
  useEffect(() => {
    if (!initialContactId) return;
    (async () => {
      try {
        const res = await fetch(`/api/contacts/search?q=&id=${encodeURIComponent(initialContactId)}`);
        if (res.ok) {
          const data = await res.json();
          const contact = data.contacts?.[0];
          if (contact) {
            selectContact(contact);
          }
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContactId]);

  // Search contacts as user types
  useEffect(() => {
    if (!contactSearch.trim() || contactSearch.length < 2) {
      setContactResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearchingContacts(true);
      try {
        const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(contactSearch.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setContactResults(data.contacts ?? []);
          setShowContactDropdown(true);
        }
      } catch { /* ignore */ }
      setSearchingContacts(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [contactSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (contactDropdownRef.current && !contactDropdownRef.current.contains(e.target as Node)) {
        setShowContactDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function selectContact(contact: typeof contactResults[number] & { deployment?: any }) {
    const dep = contact.deployment;
    setForm((prev) => ({
      ...prev,
      full_name: contact.contact_person || prev.full_name,
      email: contact.email || prev.email,
      company_name: contact.company_name || prev.company_name,
      phone: contact.phone || prev.phone,
      business_email: contact.business_email || prev.business_email,
      site_name: contact.company_name || prev.site_name,
      site_url: dep?.site_url || prev.site_url,
      codebase_link: dep?.codebase_link || prev.codebase_link,
    }));
    setDeploymentWarnings({
      site_url: !dep?.site_url,
      codebase_link: !dep?.codebase_link,
    });
    setSelectedContactId(contact.id);
    setContactSearch(contact.company_name || contact.contact_person || "");
    setShowContactDropdown(false);
    toast.success("Contact info loaded");
  }

  function clearContact() {
    setSelectedContactId(null);
    setContactSearch("");
    setDeploymentWarnings({});
    setForm({
      full_name: "",
      email: "",
      password: "",
      company_name: "",
      phone: "",
      business_email: "",
      site_name: "",
      site_url: "",
      codebase_link: "",
      initial_credits: 50,
    });
  }

  function updateField(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.full_name || !form.email) {
      toast.error("Full name and email are required");
      return;
    }
    if (!form.site_name || !form.site_url) {
      toast.error("Site name and site URL are required");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password || undefined,
          full_name: form.full_name,
          company_name: form.company_name || undefined,
          phone: form.phone || undefined,
          business_email: form.business_email || undefined,
          site_name: form.site_name,
          site_url: form.site_url,
          codebase_link: form.codebase_link || undefined,
          initial_credits: form.initial_credits,
          contact_id: selectedContactId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to create client");
        return;
      }

      setSuccess(data);
      toast.success("Client created successfully!");
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  }

  // Load email preview
  async function loadEmailPreview(customMsg?: string) {
    if (!success) return;
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        full_name: success.client.name,
        login_email: success.client.email,
        login_password: success.client.password,
        ...(form.company_name && { company_name: form.company_name }),
        ...(success.site.site_url && { site_url: success.site.site_url }),
        ...(customMsg && { custom_message: customMsg }),
      });
      const res = await fetch(`/api/admin/clients/send-welcome?${params}`);
      if (res.ok) {
        setEmailPreviewHtml(await res.text());
      }
    } catch { /* ignore */ }
    setLoadingPreview(false);
  }

  // Send welcome email
  async function handleSendEmail() {
    if (!success) return;
    setSendingEmail(true);
    try {
      const res = await fetch("/api/admin/clients/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: success.client.email,
          full_name: success.client.name,
          company_name: form.company_name || undefined,
          login_email: success.client.email,
          login_password: success.client.password,
          site_url: success.site.site_url || undefined,
          site_name: success.site.name,
          custom_message: customMessage || undefined,
        }),
      });
      if (res.ok) {
        setEmailSent(true);
        toast.success("Welcome email sent!");
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

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  function resetForm() {
    setSuccess(null);
    setCustomMessage("");
    setEmailPreviewHtml("");
    setEmailSent(false);
    setForm({
      full_name: "",
      email: "",
      password: "",
      company_name: "",
      phone: "",
      business_email: "",
      site_name: "",
      site_url: "",
      codebase_link: "",
      initial_credits: 50,
    });
  }

  // Not open — show trigger button
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="gap-2">
        <UserPlus className="h-4 w-4" />
        Create Client Account
      </Button>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
              <CardTitle className="text-base">
                Client Created Successfully
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Login credentials */}
            <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Login Credentials
              </p>
              <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 text-sm items-center">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-medium">{success.client.name}</span>
                <div />

                <span className="text-muted-foreground">Email:</span>
                <span className="font-medium font-mono text-xs">
                  {success.client.email}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() =>
                    copyToClipboard(success.client.email, "email")
                  }
                >
                  {copied === "email" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>

                <span className="text-muted-foreground">Password:</span>
                <span className="font-medium font-mono text-xs bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">
                  {success.client.password}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() =>
                    copyToClipboard(success.client.password, "password")
                  }
                >
                  {copied === "password" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {/* Site details */}
            <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Site Details
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Site:</span>
                <span className="font-medium">{success.site.name}</span>
                <span className="text-muted-foreground">URL:</span>
                <a href={success.site.site_url} target="_blank" rel="noopener noreferrer" className="font-medium text-xs truncate text-blue-600 hover:underline">
                  {success.site.site_url}
                </a>
                <span className="text-muted-foreground">Credits:</span>
                <span className="font-medium">{success.site.credits}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Welcome Email Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Welcome Email
              </CardTitle>
              {emailSent && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Sent
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Preview and send the welcome email with login credentials to the client.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Custom message */}
            <div className="space-y-1.5">
              <Label htmlFor="custom_message">Custom Message (optional)</Label>
              <textarea
                id="custom_message"
                className="w-full h-20 rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Add a personal note to the client... (shows as a highlighted box in the email)"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
              />
            </div>

            {/* Preview button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => loadEmailPreview(customMessage)}
              disabled={loadingPreview}
            >
              {loadingPreview ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {emailPreviewHtml ? "Refresh Preview" : "Preview Email"}
            </Button>

            {/* Email preview iframe */}
            {emailPreviewHtml && (
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-muted/30 px-3 py-1.5 border-b flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Email Preview</span>
                  <span className="text-xs text-muted-foreground">To: {success.client.email}</span>
                </div>
                <iframe
                  srcDoc={emailPreviewHtml}
                  className="w-full bg-white"
                  style={{ height: 480, border: "none" }}
                  title="Email preview"
                />
              </div>
            )}

            {/* Send / Re-send buttons */}
            <div className="flex gap-2">
              <Button
                className="gap-2 flex-1"
                onClick={handleSendEmail}
                disabled={sendingEmail}
              >
                {sendingEmail ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : emailSent ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sendingEmail ? "Sending..." : emailSent ? "Send Again" : "Send Welcome Email"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={resetForm}>
            Create Another
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              setOpen(false);
              resetForm();
              router.refresh();
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  // Main form
  const slug = form.site_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add New Client</CardTitle>
        <p className="text-sm text-muted-foreground">
          Create a client account and link their deployed website. Client
          edits directly on the live site via the inline editor.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contact Search */}
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-2">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400 uppercase tracking-wide">
              Search Existing Contact
            </p>
            <p className="text-xs text-muted-foreground">
              Search by company name, contact person, or email to auto-fill the form.
            </p>
            <div className="relative" ref={contactDropdownRef}>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search contacts…"
                  value={contactSearch}
                  onChange={(e) => {
                    setContactSearch(e.target.value);
                    setSelectedContactId(null);
                  }}
                  className="pl-8 pr-8 h-8 text-sm"
                />
                {(contactSearch || selectedContactId) && (
                  <button
                    type="button"
                    onClick={clearContact}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {searchingContacts && (
                <div className="absolute right-10 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                </div>
              )}
              {showContactDropdown && contactResults.length > 0 && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg py-1 max-h-48 overflow-y-auto">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectContact(c)}
                      className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-sm"
                    >
                      <span className="font-medium">{c.company_name || c.contact_person || "Unnamed"}</span>
                      {c.contact_person && c.company_name && (
                        <span className="text-muted-foreground ml-1.5">— {c.contact_person}</span>
                      )}
                      {c.email && (
                        <span className="block text-xs text-muted-foreground">{c.email}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {showContactDropdown && contactSearch.length >= 2 && contactResults.length === 0 && !searchingContacts && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg py-3 text-center text-xs text-muted-foreground">
                  No contacts found
                </div>
              )}
            </div>
            {selectedContactId && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Contact loaded — fields auto-filled below
              </p>
            )}
          </div>

          {/* Step 1: Client Info */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide border-b pb-2">
              Step 1 — Client Information
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Full Name *</Label>
                <Input
                  id="full_name"
                  placeholder="Jan Novak"
                  value={form.full_name}
                  onChange={(e) => updateField("full_name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company_name">Company Name</Label>
                <Input
                  id="company_name"
                  placeholder="Company s.r.o."
                  value={form.company_name}
                  onChange={(e) =>
                    updateField("company_name", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Login Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jan@example.com"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Client uses this to log in. Welcome email sent here.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  Password{" "}
                  <span className="text-muted-foreground font-normal">
                    (auto-generated if empty)
                  </span>
                </Label>
                <Input
                  id="password"
                  placeholder="Leave empty to auto-generate"
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  placeholder="+421..."
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="business_email">Business Email</Label>
                <Input
                  id="business_email"
                  type="email"
                  placeholder="info@company.sk"
                  value={form.business_email}
                  onChange={(e) => updateField("business_email", e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Contact form messages from visitors go here.
                </p>
              </div>
            </div>
          </div>

          {/* Step 2: Site Info */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide border-b pb-2">
              Step 2 — Website Details
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="site_name">Site Name *</Label>
                <Input
                  id="site_name"
                  placeholder="ABC Plumbing"
                  value={form.site_name}
                  onChange={(e) => updateField("site_name", e.target.value)}
                  required
                />
                {slug && (
                  <p className="text-xs text-muted-foreground">
                    Slug: {slug}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="initial_credits">Initial Balance (€)</Label>
                <Input
                  id="initial_credits"
                  type="number"
                  min="0"
                  value={form.initial_credits}
                  onChange={(e) =>
                    updateField(
                      "initial_credits",
                      parseInt(e.target.value) || 0
                    )
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  1 change = 12,50 €
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site_url">Live Website URL *</Label>
                <Input
                  id="site_url"
                  type="url"
                  placeholder="https://abc-plumbing.2dni.sk"
                  value={form.site_url}
                  onChange={(e) => updateField("site_url", e.target.value)}
                  required
                  className={deploymentWarnings.site_url ? "border-red-400" : ""}
                />
                {deploymentWarnings.site_url && (
                  <p className="text-[11px] text-red-500 font-medium">
                    No live deployment found — enter URL manually
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="codebase_link">Codebase Link</Label>
                <Input
                  id="codebase_link"
                  type="url"
                  placeholder="https://github.com/..."
                  value={form.codebase_link}
                  onChange={(e) =>
                    updateField("codebase_link", e.target.value)
                  }
                  className={deploymentWarnings.codebase_link ? "border-red-400" : ""}
                />
                {deploymentWarnings.codebase_link ? (
                  <p className="text-[11px] text-red-500 font-medium">
                    No codebase link found — enter manually
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    GitHub repo or project link
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={creating}
              className="gap-2 flex-1"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {creating ? "Creating..." : "Create Client & Site"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
