"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft,
  Rocket,
  FileCode,
  Globe,
  Copy,
  Loader2,
  Send,
  Phone,
  Mail,
  MapPin,
  Building2,
  Link2,
  ExternalLink,
  Hammer,
  UserPlus,
  CheckCircle,
  AlertCircle,
  GitBranch,
} from "lucide-react";
import { ProposalProgress } from "@/components/proposal-progress";
import { ProposalMessages } from "@/components/proposal-messages";

interface ProposalData {
  id: string;
  contact_id: string | null;
  company_name: string;
  industry: string | null;
  town: string | null;
  status: string;
  price: number | null;
  discount_price: number | null;
  base_price: number | null;
  services: string[] | null;
  requirements: string | null;
  content_overrides: Record<string, unknown> | null;
  created_at: string;
  contacts: {
    company_name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    business_email: string | null;
    industry: string | null;
    town: string | null;
    website_url: string | null;
    location: string | null;
    social_links: string | null;
    notes: string | null;
    quoted_price: number | null;
    client_status: string | null;
  } | null;
}

interface DeploymentData {
  id: string;
  subdomain: string;
  deploy_status: string;
  github_url: string | null;
  deployed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  building:  "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  review:    "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  revision:  "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  sent:      "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

interface ClientAccountData {
  email: string | null;
  fullName: string | null;
  siteId: string;
  siteUrl: string | null;
  tempPassword: string | null;
}

export function BuildWorkspaceClient({
  proposal: raw,
  deployment: rawDeployment,
  currentUserId,
  clientAccount: initialClientAccount,
}: {
  proposal: Record<string, unknown>;
  deployment: Record<string, unknown> | null;
  currentUserId: string;
  clientAccount?: ClientAccountData | null;
}) {
  const proposal = raw as unknown as ProposalData;
  const deployment = rawDeployment as unknown as DeploymentData | null;
  const router = useRouter();
  const [deploying, setDeploying] = useState(false);
  const [starting, setStarting] = useState(false);

  // GitHub repo URL — IT guy pushes code directly to GitHub, then provides the URL here
  const [githubRepoUrl, setGithubRepoUrl] = useState(deployment?.github_url || "");

  const isDeployed = deployment?.deploy_status === "live";
  const liveUrl = isDeployed ? `https://${deployment?.subdomain}.2dni.sk` : null;

  // Client account form (Step 3 of pipeline)
  const [creatingClient, setCreatingClient] = useState(false);
  const [clientCreated, setClientCreated] = useState(!!initialClientAccount);
  const [createdClientData, setCreatedClientData] = useState<ClientAccountData | null>(initialClientAccount || null);
  const [clientForm, setClientForm] = useState({
    full_name: raw.contacts ? (raw.contacts as ProposalData["contacts"])?.contact_person || "" : "",
    email: raw.contacts ? (raw.contacts as ProposalData["contacts"])?.email || "" : "",
    password: "",
    company_name: (raw as unknown as ProposalData).company_name || "",
    site_name: (raw as unknown as ProposalData).company_name || "",
  });

  // (Welcome email state removed — auto-sent on payment confirmation.)

  // Per-script injection state
  const rawFlags = raw as unknown as {
    widget_injected?: boolean;
    contact_handler_injected?: boolean;
    editor_helper_injected?: boolean;
  };
  const [paymentWidgetOn, setPaymentWidgetOn] = useState(Boolean(rawFlags.widget_injected));
  const [contactHandlerOn, setContactHandlerOn] = useState(Boolean(rawFlags.contact_handler_injected));
  const [editorHelperOn, setEditorHelperOn] = useState(Boolean(rawFlags.editor_helper_injected));
  const [businessEmail, setBusinessEmail] = useState<string>(
    ((raw.contacts as ProposalData["contacts"])?.business_email as string | null) || "",
  );
  const initialBusinessEmail =
    ((raw.contacts as ProposalData["contacts"])?.business_email as string | null) || "";

  const [applyingScripts, setApplyingScripts] = useState(false);

  async function handleApplyScripts() {
    setApplyingScripts(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/inject-widget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentWidget: paymentWidgetOn,
          contactHandler: contactHandlerOn,
          editorHelper: editorHelperOn,
          businessEmail: businessEmail.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to apply scripts");
        return;
      }
      toast.success(`Scripts updated — ${data.files_updated} file(s) changed`);
    } catch {
      toast.error("Network error");
    } finally {
      setApplyingScripts(false);
    }
  }

  async function handleCreateClient() {
    if (!clientForm.full_name || !clientForm.email) {
      toast.error("Full name and email are required");
      return;
    }

    setCreatingClient(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: clientForm.email,
          password: clientForm.password || undefined,
          full_name: clientForm.full_name,
          company_name: clientForm.company_name || undefined,
          site_name: clientForm.site_name,
          site_url: liveUrl || "",
          codebase_link: deployment?.github_url || githubRepoUrl || undefined,
          initial_credits: 50,
          contact_id: proposal.contact_id || undefined,
          proposal_id: proposal.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create client");
        return;
      }

      const pwd = data.client?.password || clientForm.password || "(auto-generated)";

      // Auto-send account details as handover message to salesperson
      try {
        await fetch(`/api/proposals/${proposal.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Client account created:\n• Email: ${clientForm.email}\n• Password: ${pwd}\n• Site: ${liveUrl || data.site?.site_url || ""}\n\nReady for handover.`,
          }),
        });
      } catch { /* message send is best-effort */ }

      setClientCreated(true);
      setCreatedClientData({
        email: clientForm.email,
        fullName: clientForm.full_name,
        siteId: data.site?.id || "",
        siteUrl: liveUrl || data.site?.site_url || null,
        tempPassword: pwd,
      });
      toast.success("Client account created!");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setCreatingClient(false);
    }
  }


  // Subdomain input
  const [subdomain, setSubdomain] = useState("");
  const [subdomainError, setSubdomainError] = useState("");
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);
  const [changingSubdomain, setChangingSubdomain] = useState(false);
  const [subdomainSuccess, setSubdomainSuccess] = useState(false);

  // Auto-populate subdomain from company name or existing deployment
  useEffect(() => {
    if (isDeployed && deployment?.subdomain) {
      setSubdomain(deployment.subdomain);
    } else if (!subdomain && proposal.company_name) {
      const slug = proposal.company_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
      setSubdomain(slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasRepo = !!githubRepoUrl.trim();

  const contact = proposal.contacts;
  const socialLinks = contact?.social_links?.split("\n").filter(Boolean) ?? [];

  async function startBuilding() {
    setStarting(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "building" }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to start");
        return;
      }
      toast.success("Building started!");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setStarting(false);
    }
  }

  async function sendToReview() {
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "review" }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update status");
        return;
      }
      toast.success("Sent to sales for review!");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  async function handleSubdomainChange(value: string) {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSubdomain(cleaned);
    setSubdomainError("");
  }

  async function checkSubdomain(): Promise<boolean> {
    if (!subdomain || subdomain.length < 3) {
      setSubdomainError("Subdomain must be at least 3 characters");
      return false;
    }
    setCheckingSubdomain(true);
    setSubdomainError("");
    try {
      const res = await fetch(
        `/api/deploy/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`
      );
      const data = await res.json();
      if (!data.available) {
        setSubdomainError(data.error || "Subdomain already taken");
        return false;
      }
      return true;
    } catch {
      setSubdomainError("Could not verify subdomain");
      return false;
    } finally {
      setCheckingSubdomain(false);
    }
  }

  async function changeSubdomain() {
    if (!deployment || !subdomain || subdomain.length < 3) {
      setSubdomainError("Subdomain must be at least 3 characters");
      return;
    }
    if (subdomain === deployment.subdomain) return;
    setChangingSubdomain(true);
    setSubdomainError("");
    setSubdomainSuccess(false);
    try {
      const checkRes = await fetch(
        `/api/deploy/check-subdomain?subdomain=${encodeURIComponent(subdomain)}&exclude_id=${deployment.id}`
      );
      const checkData = await checkRes.json();
      if (!checkData.available) {
        setSubdomainError(checkData.error || "Subdomain already taken");
        return;
      }
      const res = await fetch("/api/deploy/subdomain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployment_id: deployment.id, new_subdomain: subdomain }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubdomainError(data.error || "Failed to change subdomain");
        return;
      }
      setSubdomainSuccess(true);
      toast.success("Subdomain changed! New URL may take a few minutes to activate.");
      setTimeout(() => setSubdomainSuccess(false), 5000);
      router.refresh();
    } catch {
      setSubdomainError("Network error");
    } finally {
      setChangingSubdomain(false);
    }
  }

  async function deployWebsite() {
    if (!hasRepo) {
      toast.error("Provide a GitHub repo URL before deploying");
      return;
    }

    // For first deploy, check subdomain availability
    if (!isDeployed) {
      const available = await checkSubdomain();
      if (!available) return;
    }

    setDeploying(true);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposal.id,
          subdomain: isDeployed ? undefined : subdomain,
          github_repo_url: githubRepoUrl || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Deployment failed");
        return;
      }

      toast.success("Deployed successfully! Website is now live.");
      router.refresh();
    } catch {
      toast.error("Deployment failed");
    } finally {
      setDeploying(false);
    }
  }

  const isSubmitted = proposal.status === "submitted";
  const isActive = ["building", "revision"].includes(proposal.status);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/tech/proposals")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-bold">{proposal.company_name}</h1>
            <p className="text-sm text-muted-foreground">
              {proposal.industry || contact?.industry || "General"} · {proposal.town || contact?.town || "—"}
            </p>
          </div>
        </div>
        <Badge className={STATUS_COLORS[proposal.status] || ""}>
          {proposal.status}
        </Badge>
      </div>

      {/* Start Building CTA — shown when proposal is just submitted */}
      {isSubmitted && (
        <div className="rounded-lg border-2 border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/30 p-6 text-center space-y-3">
          <Hammer className="h-8 w-8 text-purple-500 mx-auto" />
          <div>
            <p className="text-sm font-semibold">New Proposal Request</p>
            <p className="text-xs text-muted-foreground mt-1">
              Review the details below and click Start Building when ready.
              The sales person will see that you&apos;ve started working on it.
            </p>
          </div>
          <Button onClick={startBuilding} disabled={starting} className="gap-2">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
            {starting ? "Starting..." : "Start Building"}
          </Button>
        </div>
      )}

      {/* Progress Tracker */}
      <div className="rounded-lg border bg-card p-4">
        <ProposalProgress status={proposal.status} hasProposal={true} />
      </div>

      {/* Build Pipeline Steps */}
      {isActive && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-0">
            {/* Step 1: Upload */}
            <div className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 ${
                hasRepo ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"
              }`}>
                {hasRepo ? <CheckCircle className="h-4 w-4" /> : "1"}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${hasRepo ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  GitHub Repo
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {hasRepo ? "Repo linked" : "Paste GitHub URL"}
                </p>
              </div>
            </div>
            <div className={`h-0.5 w-8 mx-1 ${isDeployed ? "bg-emerald-500" : "bg-border"}`} />
            {/* Step 2: Deploy */}
            <div className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 ${
                isDeployed ? "bg-emerald-500 text-white" : hasRepo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {isDeployed ? <CheckCircle className="h-4 w-4" /> : "2"}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${isDeployed ? "text-emerald-600 dark:text-emerald-400" : !hasRepo ? "text-muted-foreground" : ""}`}>
                  Deploy
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {isDeployed ? `${deployment?.subdomain}.2dni.sk` : "Subdomain + deploy"}
                </p>
              </div>
            </div>
            <div className={`h-0.5 w-8 mx-1 ${clientCreated ? "bg-emerald-500" : "bg-border"}`} />
            {/* Step 3: Client Account */}
            <div className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 ${
                clientCreated ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {clientCreated ? <CheckCircle className="h-4 w-4" /> : "3"}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${clientCreated ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                  Client Account
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {createdClientData?.email || "Auto after deploy"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Script toggles — only after deploy */}
      {isDeployed && (() => {
        const hasChanges =
          paymentWidgetOn !== Boolean(rawFlags.widget_injected) ||
          contactHandlerOn !== Boolean(rawFlags.contact_handler_injected) ||
          editorHelperOn !== Boolean(rawFlags.editor_helper_injected) ||
          businessEmail.trim() !== initialBusinessEmail;

        const ScriptRow = ({
          label,
          desc,
          on,
          setOn,
        }: {
          label: string;
          desc: string;
          on: boolean;
          setOn: (v: boolean) => void;
        }) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-2">
                {label}
                <span
                  className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${
                    on
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {on ? "ON" : "OFF"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => setOn(!on)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                on ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  on ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        );

        return (
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <p className="text-sm font-medium">Scripts on deployed site</p>

            <div className="space-y-3">
              <ScriptRow
                label="Payment widget"
                desc="Payment banner with QR, price, and 'I need changes' link. Only shown while proposal is sent/viewed."
                on={paymentWidgetOn}
                setOn={setPaymentWidgetOn}
              />

              <div className="space-y-2">
                <ScriptRow
                  label="Contact form handler"
                  desc="Makes the site's contact form actually send emails to the business email."
                  on={contactHandlerOn}
                  setOn={setContactHandlerOn}
                />
                {contactHandlerOn && (
                  <div className="ml-0 pl-3 border-l-2 border-primary/20 space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Contact form submissions go to:
                    </label>
                    <Input
                      type="email"
                      value={businessEmail}
                      onChange={(e) => setBusinessEmail(e.target.value)}
                      placeholder="info@client.com"
                      className="h-8 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Changes here will update the contact record + re-inject with the new email.
                    </p>
                  </div>
                )}
              </div>

              <ScriptRow
                label="Editor helper"
                desc="Scroll-sync bridge for client-zone iframe previews (postMessage listener)."
                on={editorHelperOn}
                setOn={setEditorHelperOn}
              />
            </div>

            <Button
              onClick={handleApplyScripts}
              disabled={applyingScripts || !hasChanges}
              className="w-full gap-2"
              size="sm"
            >
              {applyingScripts ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : hasChanges ? (
                "Apply changes"
              ) : (
                "No changes"
              )}
            </Button>
          </div>
        );
      })()}

      {/* Step 3: Client Account — form or success */}
      {isDeployed && !clientCreated && (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="h-4 w-4" />
            Create Client Account
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Full Name *</label>
              <Input
                value={clientForm.full_name}
                onChange={(e) => setClientForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Contact person name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Email *</label>
              <Input
                value={clientForm.email}
                onChange={(e) => setClientForm(f => ({ ...f, email: e.target.value }))}
                placeholder="client@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Password</label>
              <Input
                value={clientForm.password}
                onChange={(e) => setClientForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Auto-generated if empty"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Company</label>
              <Input
                value={clientForm.company_name}
                onChange={(e) => setClientForm(f => ({ ...f, company_name: e.target.value }))}
                placeholder="Company name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Site Name</label>
              <Input
                value={clientForm.site_name}
                onChange={(e) => setClientForm(f => ({ ...f, site_name: e.target.value }))}
                placeholder="Website display name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Live URL</label>
              <Input value={liveUrl || ""} disabled className="font-mono text-xs" />
            </div>
          </div>
          <Button
            onClick={handleCreateClient}
            disabled={creatingClient || !clientForm.full_name || !clientForm.email}
            className="gap-2"
          >
            {creatingClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {creatingClient ? "Creating..." : "Create Client Account"}
          </Button>
        </div>
      )}

      {/* Client account success + persistent credentials block */}
      {clientCreated && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              Client account ready
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                if (!createdClientData?.email) return;
                const params = new URLSearchParams({
                  full_name: createdClientData.fullName || "",
                  login_email: createdClientData.email,
                  login_password: createdClientData.tempPassword || "********",
                  ...(clientForm.company_name && { company_name: clientForm.company_name }),
                  ...(liveUrl && { site_url: liveUrl }),
                });
                window.open(`/api/admin/clients/send-welcome?${params}`, "_blank");
              }}
            >
              <ExternalLink className="h-3 w-3" />
              Preview welcome email
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Login Email</p>
              <div className="flex items-center gap-1">
                <p className="font-mono text-xs flex-1 truncate">{createdClientData?.email}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (createdClientData?.email) {
                      navigator.clipboard.writeText(createdClientData.email);
                      toast.success("Email copied");
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                  title="Copy email"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>

            {createdClientData?.tempPassword && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Password</p>
                <div className="flex items-center gap-1">
                  <p className="font-mono text-xs flex-1 truncate">{createdClientData.tempPassword}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (createdClientData?.tempPassword) {
                        navigator.clipboard.writeText(createdClientData.tempPassword);
                        toast.success("Password copied");
                      }
                    }}
                    className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                    title="Copy password"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded border border-dashed border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/40 dark:bg-emerald-900/10 px-3 py-2">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
              <strong>Welcome email is auto-sent</strong> when the client pays.
              Until then, the client can already access their zone via the
              "I need changes" link in the proposal banner.
            </p>
          </div>
        </div>
      )}

      {/* Actions bar — only when actively building */}
      {isActive && (
        <div className="space-y-3">
          {isDeployed && (
            <Button size="sm" variant="default" onClick={sendToReview} className="gap-2">
              <Send className="h-4 w-4" />
              Send to Sales for Review
            </Button>
          )}

          {/* GitHub Repo URL + Subdomain + Deploy button */}
          {!isDeployed && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" />
                  GitHub Repository URL *
                </label>
                <Input
                  value={githubRepoUrl}
                  onChange={(e) => setGithubRepoUrl(e.target.value.trim())}
                  placeholder="https://github.com/owner/repo-name"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Push the website codebase to GitHub first, then paste the repo URL here.
                </p>
              </div>
            </div>
          )}

          {hasRepo && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Subdomain</label>
                <div className="flex items-center gap-0">
                  <Input
                    value={subdomain}
                    onChange={(e) => handleSubdomainChange(e.target.value)}
                    placeholder="company-name"
                    disabled={isDeployed}
                    className="rounded-r-none font-mono text-sm"
                  />
                  <span className="inline-flex items-center h-9 px-3 border border-l-0 rounded-r-md bg-muted text-sm text-muted-foreground whitespace-nowrap">
                    .2dni.sk
                  </span>
                </div>
                {subdomainError && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {subdomainError}
                  </div>
                )}
                {!isDeployed && subdomain && !subdomainError && (
                  <p className="text-xs text-muted-foreground">
                    Will be live at: https://{subdomain}.2dni.sk
                  </p>
                )}
                {isDeployed && (
                  <p className="text-xs text-muted-foreground">
                    Subdomain is locked after first deploy. Sales can change it during review.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={deployWebsite}
                disabled={deploying || checkingSubdomain || (!isDeployed && !subdomain)}
                className="gap-2"
              >
                {deploying || checkingSubdomain ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                {checkingSubdomain
                  ? "Checking subdomain..."
                  : deploying
                  ? isDeployed
                    ? "Redeploying..."
                    : "Deploying..."
                  : isDeployed
                  ? "Redeploy"
                  : "Deploy to Live"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Live site + repo links + subdomain editor */}
      {isDeployed && liveUrl && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3 space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-muted-foreground shrink-0">Live at:</span>
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline truncate"
            >
              {liveUrl}
            </a>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(liveUrl);
                toast.success("URL copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          {deployment?.github_url && (
            <div className="flex items-center gap-3 text-sm">
              <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground shrink-0">Repo:</span>
              <a
                href={deployment.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-muted-foreground hover:text-foreground hover:underline truncate flex items-center gap-1"
              >
                {deployment.github_url.replace("https://github.com/", "")}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto shrink-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(deployment.github_url!);
                  toast.success("Repo URL copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {/* Change subdomain */}
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Change Subdomain</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0 flex-1">
                <Input
                  value={subdomain}
                  onChange={(e) => handleSubdomainChange(e.target.value)}
                  placeholder="subdomain"
                  className="rounded-r-none font-mono text-sm"
                />
                <span className="inline-flex items-center h-9 px-3 border border-l-0 rounded-r-md bg-muted text-sm text-muted-foreground whitespace-nowrap">
                  .2dni.sk
                </span>
              </div>
              <Button
                size="sm"
                onClick={changeSubdomain}
                disabled={changingSubdomain || !subdomain || subdomain === deployment?.subdomain}
                className="shrink-0 gap-1.5"
              >
                {changingSubdomain ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : subdomainSuccess ? (
                  <CheckCircle className="h-3.5 w-3.5" />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
                {changingSubdomain ? "Changing..." : subdomainSuccess ? "Done" : "Change"}
              </Button>
            </div>
            {subdomainError && (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {subdomainError}
              </div>
            )}
            {subdomainSuccess && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Subdomain changed. The new URL may take a few minutes to become active.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Services + Price + Requirements from salesperson */}
      {(() => {
        const rawServices = proposal.services;
        const services: string[] = Array.isArray(rawServices) ? rawServices : (typeof rawServices === "string" ? JSON.parse(rawServices) : []);
        const hasServices = services.length > 0 && services.some((s: string) => s.trim());
        const hasRequirements = proposal.requirements;
        if (!hasServices && !hasRequirements) return null;
        return (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b">
              <p className="text-sm font-medium">From Sales</p>
            </div>
            <div className="px-4 py-3 space-y-3">
              {hasServices && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Main Services</p>
                  <ul className="space-y-1 text-sm">
                    {services.filter((s: string) => s.trim()).map((s: string, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hasRequirements && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{proposal.requirements}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Contact Details — ALL info from sales */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium">Contact Details</p>
        </div>
        {contact ? (
          <div className="divide-y text-sm">
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={contact.company_name} />
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Person" value={contact.contact_person} />
            <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} mono />
            <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
            {contact.business_email && <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Biz Email" value={contact.business_email} href={`mailto:${contact.business_email}`} />}
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Industry" value={contact.industry} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Town" value={contact.town} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={contact.location} />
            {contact.website_url && (
              <div className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-0.5 text-muted-foreground shrink-0"><Globe className="h-3.5 w-3.5" /></span>
                <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">Website</span>
                <a href={contact.website_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate flex items-center gap-1">
                  {contact.website_url.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
              </div>
            )}
            {contact.quoted_price != null && contact.quoted_price > 0 && (
              <InfoRow icon={null} label="Quoted" value={`$${Number(contact.quoted_price).toLocaleString()}`} />
            )}
            {socialLinks.length > 0 && (
              <div className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-0.5 text-muted-foreground shrink-0"><Link2 className="h-3.5 w-3.5" /></span>
                <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">Links</span>
                <div className="space-y-1 text-xs min-w-0">
                  {socialLinks.map((l, i) => (
                    <a key={i} href={l} target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline truncate">
                      {l.replace(/^https?:\/\//, "")}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {contact.notes && (
              <div className="px-4 py-2.5">
                <p className="text-xs font-medium text-muted-foreground mb-1">Sales Notes</p>
                <p className="text-xs text-foreground whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No contact linked to this proposal
          </div>
        )}
      </div>

      {/* Build Requirements */}
      {proposal.requirements && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-medium">Build Requirements</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm whitespace-pre-wrap">{proposal.requirements}</p>
          </div>
        </div>
      )}

      {/* GitHub Repo Link */}
      {(githubRepoUrl || deployment?.github_url) && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Codebase</p>
          </div>
          <div className="px-4 py-3">
            <a href={deployment?.github_url || githubRepoUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                View on GitHub
              </Button>
            </a>
          </div>
        </div>
      )}

      {/* Messages — threaded communication with sales */}
      <ProposalMessages proposalId={proposal.id} currentUserId={currentUserId} currentUserRole="tech_admin" />
    </div>
  );
}

// ── Info row ─────────────────────────────────────────────────────────────────
function InfoRow({
  icon, label, value, href, mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">{label}</span>
      {href ? (
        <a href={href} className="text-xs text-primary hover:underline truncate">{value}</a>
      ) : (
        <span className={`text-xs ${mono ? "font-mono" : ""} text-foreground`}>{value}</span>
      )}
    </div>
  );
}
