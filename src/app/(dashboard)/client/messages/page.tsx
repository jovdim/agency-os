import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { MessageSquare } from "lucide-react";
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
      <div className="max-w-2xl mx-auto py-12 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Your website is still being prepared.</p>
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Need help?
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Write to us about how we can help. Our team will receive your
          message and we will get back to you as soon as possible.
        </p>
      </div>

      <ClientMessageForm siteId={site.id} />

      {/* Previous messages — read-only list of past support threads.
          Status badge maps the change_request lifecycle (pending /
          approved / rejected) to client-friendly labels. */}
      {messageRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Previous messages
          </h2>
          {messageRequests.map((msg) => {
            let messageText = "";
            try {
              const changes = typeof msg.changes === "string" ? JSON.parse(msg.changes) : msg.changes;
              messageText = changes?.[0]?.new_value || "";
            } catch { /* ignore */ }

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
              <div key={msg.id} className="rounded-lg border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[msg.status] ?? "bg-muted"}`}>
                    {STATUS_LABEL[msg.status] ?? msg.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.created_at).toLocaleDateString("en-GB")}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{messageText}</p>
                {msg.admin_notes && (
                  <div className="rounded-md bg-muted/50 px-3 py-2 mt-2">
                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Reply:</p>
                    <p className="text-sm">{msg.admin_notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
