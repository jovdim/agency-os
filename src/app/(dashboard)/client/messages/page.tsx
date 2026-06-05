import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ChatText as MessageSquare, Lifebuoy as LifeBuoy, Clock, CheckCircle as CheckCircle2, XCircle, ArrowElbowDownRight as CornerDownRight } from "@phosphor-icons/react/ssr";
import { ClientMessageForm } from "./client-message-form";

export const dynamic = "force-dynamic";

export default async function ClientMessagesPage() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Get client's site. Messages don't care about is_paid or credits
  // anymore (free for everyone) — the form just needs the site id to
  // attach the change_request to.
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const site = sites?.[0];

  if (!site) {
    return (
      <div className="dash-root mx-auto max-w-2xl py-16">
        <div className="dash-panel flex flex-col items-center px-6 py-14 text-center">
          <span className="dash-chip mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl">
            <MessageSquare className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">Your website is still being prepared.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Once it&apos;s live you&apos;ll be able to message our team from here.
          </p>
        </div>
      </div>
    );
  }

  // Fetch previous messages (change requests with type "message")
  const { data: messages } = await supabase
    .from("change_requests")
    .select("id, status, admin_notes, created_at, changes")
    .eq("site_id", site.id)
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Filter to only message-type requests
  const messageRequests = (messages ?? []).filter((m) => {
    try {
      const changes = typeof m.changes === "string" ? JSON.parse(m.changes) : m.changes;
      return Array.isArray(changes) && changes.length === 1 && changes[0]?.action === "message";
    } catch {
      return false;
    }
  });

  // One small lucide icon per status — drives the per-message icon chip so the
  // thread scans by state at a glance (calm single-tone tints, never a
  // gradient).
  const STATUS_ICON: Record<string, typeof Clock> = {
    pending: Clock,
    approved: CheckCircle2,
    rejected: XCircle,
  };
  const STATUS_LABEL: Record<string, string> = {
    pending: "Awaiting response",
    approved: "Resolved",
    rejected: "Rejected",
  };
  const STATUS_STYLE: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };

  return (
    <div className="dash-root mx-auto max-w-2xl space-y-8">
      {/* ── Page header — clean title + subtitle with a quiet support icon
          chip. No gradient on this calm help page. ── */}
      <div className="flex items-start gap-3">
        <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <LifeBuoy className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Support
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Need help?</h1>
          <p className="text-sm text-muted-foreground">
            Write to us about how we can help. Our team will receive your
            message and we&apos;ll get back to you as soon as possible.
          </p>
        </div>
      </div>

      <ClientMessageForm siteId={site.id} />

      {/* Previous messages — read-only list of past support threads inside a
          soft panel. Status chip maps the change_request lifecycle (pending /
          approved / rejected) to client-friendly labels. */}
      {messageRequests.length > 0 && (
        <div className="dash-panel overflow-hidden">
          <div className="dash-subhead flex items-center gap-2 px-5 py-2.5">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Previous messages
            </h2>
          </div>
          <ul className="dash-hairline divide-y">
            {messageRequests.map((msg) => {
              let messageText = "";
              try {
                const changes = typeof msg.changes === "string" ? JSON.parse(msg.changes) : msg.changes;
                messageText = changes?.[0]?.new_value || "";
              } catch { /* ignore */ }

              const StatusIcon = STATUS_ICON[msg.status] ?? MessageSquare;

              return (
                <li key={msg.id} className="flex gap-3 px-5 py-4">
                  <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                    <StatusIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[msg.status] ?? "bg-muted"}`}
                      >
                        {STATUS_LABEL[msg.status] ?? msg.status}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {new Date(msg.created_at).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{messageText}</p>
                    {msg.admin_notes && (
                      <div className="dash-subhead flex gap-2 rounded-lg px-3 py-2">
                        <CornerDownRight className="dash-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Reply
                          </p>
                          <p className="text-sm">{msg.admin_notes}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
