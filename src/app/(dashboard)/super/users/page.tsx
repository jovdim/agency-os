"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
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
import {
  UserPlus,
  Search,
  Pencil,
  CheckCircle,
  Loader2,
  Shield,
  Hammer,
  PhoneCall,
  Star,
  Users as UsersIcon,
  Copy,
  Eye,
  EyeOff,
  AtSign,
} from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { UserRole, Profile } from "@/types/database";

const STAFF_ROLES: UserRole[] = ["super_admin", "administrator", "tech_admin", "sales"];
const CREATABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "tech_admin", label: "Tech Admin" },
  { value: "administrator", label: "Administrator" },
  { value: "super_admin", label: "Super Admin" },
];

// Per-role display: label and icon only. Kept grayscale on purpose so
// the page reads as a clean roster rather than a colored org chart.
// Different icon per role still helps scanning between sections.
const ROLE_DISPLAY: Record<UserRole, { label: string; icon: React.ElementType }> = {
  super_admin: { label: "Super Admin", icon: Shield },
  tech_admin: { label: "Tech Admin", icon: Hammer },
  sales: { label: "Sales", icon: PhoneCall },
  administrator: { label: "Administrator", icon: Star },
  client: {
    // Never rendered on this page (filtered by STAFF_ROLES) — included
    // so the Record<UserRole, ...> stays exhaustive.
    label: "Client",
    icon: UsersIcon,
  },
};

// Render order for the role-grouped sections. Most powerful at the
// top so the page reads as an org chart.
const ROLE_ORDER: UserRole[] = ["super_admin", "tech_admin", "sales", "administrator"];

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>("sales");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Full edit details fetched from /api/admin/users/[id] on open.
  // Contains the login email + synthesized-email flag that don't live
  // on the profile row. Null while loading.
  const [editDetails, setEditDetails] = useState<{
    login_email: string;
    has_synthesized_email: boolean;
  } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  // Per-field reveal toggles. Stay false on each open so a closed
  // dialog never exposes the previous user's secrets.
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showBizPassword, setShowBizPassword] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleTestEmail(email: string, password: string) {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/super/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.success ? "Connection OK — test email sent" : data.error });
      if (data.success) toast.success("Email connection works!");
      else toast.error(data.error);
    } catch {
      setTestResult({ success: false, message: "Failed to test connection" });
      toast.error("Failed to test connection");
    }
    setTestingEmail(false);
  }

  const fetchUsers = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .in("role", STAFF_ROLES)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    setUsers((data as Profile[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleCreateUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const fd = new FormData(e.currentTarget);

    try {
      // The single "Username or Email" field is sent as `identifier`.
      // The API decides whether to use it as an auth email directly
      // (if it contains @) or to treat it as a username and synthesize
      // a placeholder email behind the scenes.
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: fd.get("identifier"),
          password: fd.get("password"),
          full_name: fd.get("full_name"),
          role: fd.get("role"),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      const result = await res.json();
      const newId = result.user_id ?? result.userId;

      // Profile follow-up: phone + business email pair. Done in a
      // second roundtrip so the create API stays narrow (it only
      // touches the auth row + username). Empty inputs write NULL
      // so the dialog can "clear" a value during re-creation.
      const phone = (fd.get("phone") as string)?.trim() || null;
      const businessEmail =
        (fd.get("business_email") as string)?.trim() || null;
      const businessEmailPass =
        (fd.get("business_email_password") as string)?.trim() || null;
      if (newId && (phone || businessEmail || businessEmailPass)) {
        const supabase = createClient();
        await supabase
          .from("profiles")
          .update({
            phone,
            business_email: businessEmail,
            business_email_password: businessEmailPass,
          })
          .eq("id", newId);
      }

      toast.success("Staff created");
      setDialogOpen(false);
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  // Fetch the full edit payload (profile + auth login email) whenever
  // the Edit dialog opens. We always go through the admin API because
  // the auth.users email isn't reachable via the regular Supabase
  // client. Reveal toggles are reset here so each open starts clean.
  useEffect(() => {
    if (!editOpen || !editingUser) {
      setEditDetails(null);
      setShowLoginPassword(false);
      setShowBizPassword(false);
      return;
    }
    let cancelled = false;
    setEditLoading(true);
    setEditDetails(null);
    fetch(`/api/admin/users/${editingUser.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.error) {
          toast.error(data.error);
          return;
        }
        setEditDetails({
          login_email: data.login_email || "",
          has_synthesized_email: !!data.has_synthesized_email,
        });
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load staff details");
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editOpen, editingUser]);

  async function handleSaveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    const fd = new FormData(e.currentTarget);

    // Send every editable field — the API treats undefined as "leave
    // alone", so passing the current value is fine for unchanged fields.
    // Empty strings on optional fields write NULL (the API normalizes).
    //
    // For `new_password` we explicitly avoid sending the unchanged value
    // — the field is pre-filled with the stored plaintext, so submitting
    // it as-is would pointlessly re-hash and re-write on every save.
    const typedPassword = (fd.get("new_password") as string) ?? "";
    const currentPassword = editingUser.login_password ?? "";
    const passwordToSend =
      typedPassword && typedPassword !== currentPassword ? typedPassword : "";

    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: (fd.get("full_name") as string)?.trim(),
          username: (fd.get("username") as string)?.trim() ?? "",
          phone: (fd.get("phone") as string)?.trim() ?? "",
          login_email: (fd.get("login_email") as string)?.trim() ?? "",
          new_password: passwordToSend,
          business_email: (fd.get("business_email") as string)?.trim() ?? "",
          business_email_password:
            (fd.get("business_email_password") as string) ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      toast.success("Staff updated");
      setEditOpen(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.full_name.toLowerCase().includes(q) ||
      (u.business_email && u.business_email.toLowerCase().includes(q)) ||
      (u.phone && u.phone.includes(q));
  });

  // Pre-bucket the (already filtered) list by role so each section
  // only has to render its own slice.
  const byRole: Record<UserRole, Profile[]> = {
    super_admin: [],
    tech_admin: [],
    sales: [],
    administrator: [],
    client: [],
  };
  for (const u of filtered) byRole[u.role].push(u);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            Your team — grouped by role.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Add Staff
        </Button>
      </div>

      {/* Search bar — filters across all role groups. */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff by name, phone, or email..."
          className="pl-8 h-9 text-sm"
        />
      </div>

      {loading ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {ROLE_ORDER.map((role) => {
            const meta = ROLE_DISPLAY[role];
            const Icon = meta.icon;
            const roster = byRole[role];
            // Hide empty role sections when searching so the list
            // stays compact. With no search, also hide so the page
            // doesn't show a wall of empty cards on a small team.
            if (roster.length === 0) return null;

            return (
              <div
                key={role}
                className="rounded-lg border bg-card overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                  <div className="rounded-md p-1.5 shrink-0 bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <span className="text-xs text-muted-foreground">
                    · {roster.length}
                  </span>
                </div>

                <ul className="divide-y">
                  {roster.map((user) => (
                    <li
                      key={user.id}
                      className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      {/* Initials chip — kept grayscale, just a clean
                          visual anchor for the row. */}
                      <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 bg-muted text-muted-foreground">
                        {getInitials(user.full_name)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm">
                          {user.full_name}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          <span>
                            {user.phone || (
                              <span className="text-muted-foreground/60">
                                No phone
                              </span>
                            )}
                          </span>
                          {role === "sales" && (
                            <>
                              <span className="text-muted-foreground/40">
                                ·
                              </span>
                              <span className="truncate">
                                {user.business_email || (
                                  <span className="text-muted-foreground/60">
                                    No business email
                                  </span>
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={() => {
                          setEditingUser(user);
                          setEditOpen(true);
                        }}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {/* Empty states: search-with-no-matches OR truly empty roster. */}
          {filtered.length === 0 && (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {search ? (
                  <>
                    No staff matching{" "}
                    <span className="font-medium text-foreground">
                      &ldquo;{search}&rdquo;
                    </span>
                  </>
                ) : (
                  "No staff yet — click Add Staff to get started."
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Create Staff Dialog — sectioned layout: Account → Contact →
          (sales only) Business Email. Larger inputs (h-9) and clearer
          section headers so the form reads as steps instead of a wall
          of fields. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Staff</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Create a login account for a teammate. Sales staff also need a
              business email for outreach.
            </p>
          </DialogHeader>
          <form id="create-form" onSubmit={handleCreateUser} className="space-y-5">
            {/* Section: Login account */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Login Account
              </h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Full Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    name="full_name"
                    required
                    placeholder="John Smith"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Role <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    name="role"
                    value={selectedRole}
                    onValueChange={(v) => setSelectedRole(v as UserRole)}
                  >
                    <SelectTrigger className="h-9 w-full text-sm">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {CREATABLE_ROLES.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Username or Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      name="identifier"
                      required
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="erik  /  erik@example.com"
                      className="h-9 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      They'll sign in with whichever you set.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">
                        Login Password <span className="text-red-500">*</span>
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[10px] px-1.5 -mr-1"
                        onClick={() => {
                          const pass = Math.random().toString(36).slice(2, 10);
                          setGeneratedPassword(pass);
                          const input = document.querySelector<HTMLInputElement>(
                            "#create-form [name=password]",
                          );
                          if (input) input.value = pass;
                        }}
                      >
                        Auto-generate
                      </Button>
                    </div>
                    <div className="flex gap-1">
                      <Input
                        name="password"
                        type="text"
                        required
                        minLength={6}
                        placeholder="Min 6 characters"
                        defaultValue={generatedPassword}
                        className="h-9 text-sm font-mono"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 px-2.5 shrink-0"
                        onClick={() => {
                          const input = document.querySelector<HTMLInputElement>(
                            "#create-form [name=password]",
                          );
                          const value = input?.value;
                          if (!value) {
                            toast.error("Generate or type a password first");
                            return;
                          }
                          navigator.clipboard.writeText(value).then(() => {
                            toast.success("Password copied");
                          });
                        }}
                        title="Copy password"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Contact */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </h4>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Phone{" "}
                  <span className="text-muted-foreground/70 font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  name="phone"
                  placeholder="0905123456"
                  inputMode="tel"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Section: Business email — only relevant for sales */}
            {selectedRole === "sales" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Business Email
                  </h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    disabled={testingEmail}
                    onClick={() => {
                      const form = document.querySelector<HTMLFormElement>(
                        "#create-form",
                      );
                      const email = form?.querySelector<HTMLInputElement>(
                        "[name=business_email]",
                      )?.value;
                      const pass = form?.querySelector<HTMLInputElement>(
                        "[name=business_email_password]",
                      )?.value;
                      if (email && pass) handleTestEmail(email, pass);
                      else toast.error("Fill in business email and password first");
                    }}
                  >
                    {testingEmail ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3 w-3" />
                    )}
                    {testingEmail ? "Testing..." : "Test Connection"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Used to send proposal emails to leads on this salesperson's
                  behalf.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Business Email</Label>
                    <Input
                      name="business_email"
                      type="email"
                      placeholder="name@youragency.com"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Email Password</Label>
                    <Input
                      name="business_email_password"
                      type="password"
                      placeholder="SMTP password"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                {testResult && (
                  <p
                    className={`text-[11px] ${
                      testResult.success ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {testResult.message}
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating} className="gap-1.5">
                {creating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" />
                    Create Staff
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog — mirror of Add Staff with same sectioned
          layout. Loads full details (including the login email from
          auth.users) via /api/admin/users/[id] on open. Login password
          cannot be displayed (Supabase only stores the bcrypt hash);
          instead an empty "Set new password" field lets the operator
          rotate it. Empty = no change. */}
      <Dialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditingUser(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Staff</DialogTitle>
            {editingUser && (
              <p className="text-xs text-muted-foreground">
                {editingUser.full_name}
                <span className="mx-1.5 text-muted-foreground/50">·</span>
                {ROLE_LABELS[editingUser.role]}
              </p>
            )}
          </DialogHeader>

          {editLoading || !editDetails ? (
            <div className="py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : editingUser ? (
            <form
              id="edit-form"
              onSubmit={handleSaveEdit}
              className="space-y-5"
            >
              {/* Section: Login account */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Login Account
                </h4>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Full Name</Label>
                    <Input
                      name="full_name"
                      defaultValue={editingUser.full_name}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Username</Label>
                      <Input
                        name="username"
                        defaultValue={editingUser.username ?? ""}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="erik"
                        className="h-9 text-sm"
                      />
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        Optional. Lets them log in by username.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Login Email</Label>
                      <Input
                        name="login_email"
                        type="email"
                        defaultValue={editDetails.login_email}
                        placeholder={
                          editDetails.has_synthesized_email
                            ? "Not set"
                            : "erik@example.com"
                        }
                        className="h-9 text-sm"
                      />
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {editDetails.has_synthesized_email
                          ? "No real email on file — username login only."
                          : "Can also log in with this address."}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Login Password</Label>
                    <div className="flex gap-1">
                      <div className="relative flex-1">
                        <Input
                          name="new_password"
                          type={showLoginPassword ? "text" : "password"}
                          minLength={6}
                          defaultValue={editingUser.login_password ?? ""}
                          placeholder={
                            editingUser.login_password
                              ? ""
                              : "Not stored — type a new one to make it visible"
                          }
                          className="h-9 text-sm font-mono pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
                          title={showLoginPassword ? "Hide" : "Show"}
                        >
                          {showLoginPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 px-2.5 shrink-0"
                        onClick={() => {
                          const input = document.querySelector<HTMLInputElement>(
                            "#edit-form [name=new_password]",
                          );
                          const value = input?.value;
                          if (!value) {
                            toast.error("No password to copy");
                            return;
                          }
                          navigator.clipboard.writeText(value).then(() => {
                            toast.success("Password copied");
                          });
                        }}
                        title="Copy password"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 text-[10px] px-2 shrink-0"
                        onClick={() => {
                          const pass = Math.random().toString(36).slice(2, 10);
                          const input = document.querySelector<HTMLInputElement>(
                            "#edit-form [name=new_password]",
                          );
                          if (input) input.value = pass;
                          setShowLoginPassword(true);
                        }}
                      >
                        Generate
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      {editingUser.login_password
                        ? "Edit to rotate the password — changes apply on save."
                        : "Legacy account — set a new password to make it visible here."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section: Contact */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Contact
                </h4>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Phone{" "}
                    <span className="text-muted-foreground/70 font-normal">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    name="phone"
                    defaultValue={editingUser.phone ?? ""}
                    placeholder="0905123456"
                    inputMode="tel"
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {/* Section: Business email — only relevant for sales */}
              {editingUser.role === "sales" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Business Email
                    </h4>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] gap-1"
                      disabled={testingEmail}
                      onClick={() => {
                        const form = document.querySelector<HTMLFormElement>(
                          "#edit-form",
                        );
                        const email = form?.querySelector<HTMLInputElement>(
                          "[name=business_email]",
                        )?.value;
                        const pass = form?.querySelector<HTMLInputElement>(
                          "[name=business_email_password]",
                        )?.value;
                        if (email && pass) handleTestEmail(email, pass);
                        else
                          toast.error("Fill in business email and password first");
                      }}
                    >
                      {testingEmail ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle className="h-3 w-3" />
                      )}
                      {testingEmail ? "Testing..." : "Test Connection"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    Used to send proposal emails to leads on this salesperson's
                    behalf.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Business Email</Label>
                      <Input
                        name="business_email"
                        type="email"
                        defaultValue={editingUser.business_email ?? ""}
                        placeholder="name@youragency.com"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Email Password</Label>
                      <div className="relative">
                        <Input
                          name="business_email_password"
                          type={showBizPassword ? "text" : "password"}
                          defaultValue={editingUser.business_email_password ?? ""}
                          placeholder="SMTP password"
                          className="h-9 text-sm font-mono pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBizPassword((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
                          title={showBizPassword ? "Hide" : "Show"}
                        >
                          {showBizPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  {testResult && (
                    <p
                      className={`text-[11px] ${
                        testResult.success ? "text-emerald-600" : "text-red-500"
                      }`}
                    >
                      {testResult.message}
                    </p>
                  )}
                </div>
              )}

              <DialogFooter className="gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditOpen(false);
                    setEditingUser(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} className="gap-1.5">
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
