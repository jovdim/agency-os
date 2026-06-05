import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLastActiveFor, lastActiveLabel } from "@/lib/auth/last-active";
import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Phone,
  PhoneOff,
  XCircle,
  ThumbsDown,
  Send,
  MapPin,
  Ban,
  Mail,
  Receipt,
  BarChart3,
  Percent,
  Users,
} from "lucide-react";
import { CommissionRateEditor } from "./commission-rate-editor";
import { AssignedContactsTable } from "./assigned-contacts-table";
import { SalespersonStats } from "./salesperson-stats";

export const dynamic = "force-dynamic";

const OUTCOME_LABELS: Record<string, string> = {
  new: "New",
  no_answer: "No Answer",
  not_exists: "Not Existing",
  not_interested: "Not Interested",
  send_proposal: "Proposal",
  send_email: "Email Sent",
  send_invoice: "Invoice Sent",
  callback: "Callback",
  local_market: "Local Market",
  never_contact: "Never Contact",
  interested: "Interested",
  needs_ecommerce: "E-shop",
};

const OUTCOME_ICONS: Record<string, React.ReactNode> = {
  no_answer: <PhoneOff className="h-3.5 w-3.5 text-muted-foreground" />,
  not_exists: <XCircle className="h-3.5 w-3.5 text-muted-foreground" />,
  not_interested: <ThumbsDown className="h-3.5 w-3.5 text-muted-foreground" />,
  send_proposal: <Send className="h-3.5 w-3.5 text-muted-foreground" />,
  send_email: <Mail className="h-3.5 w-3.5 text-muted-foreground" />,
  send_invoice: <Receipt className="h-3.5 w-3.5 text-muted-foreground" />,
  callback: <Phone className="h-3.5 w-3.5 text-muted-foreground" />,
  local_market: <MapPin className="h-3.5 w-3.5 text-muted-foreground" />,
  never_contact: <Ban className="h-3.5 w-3.5 text-muted-foreground" />,
};

export default async function SalespersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin");
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", id)
    .eq("role", "sales")
    .single();

  if (!person) notFound();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const [
    { data: allOutcomeRows },
    { data: todayLogs },
    { data: weekLogs },
    { data: proposals },
    { count: assignedContacts },
    { data: contactsList },
    { data: rateRow },
    lastActiveIso,
  ] = await Promise.all([
    // GROUP BY outcome at the DB instead of pulling every row to count
    // them in Node. See migration 00072_call_log_outcome_counts.sql.
    supabase.rpc("call_log_outcome_counts", { p_sales_person_id: id }),
    supabase
      .from("call_logs")
      .select("id, outcome")
      .eq("sales_person_id", id)
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("call_logs")
      .select("id, outcome")
      .eq("sales_person_id", id)
      .gte("created_at", weekStart.toISOString()),
    supabase
      .from("proposals")
      .select("id, status, created_at, sent_at, viewed_at, paid_at")
      .eq("sales_person_id", id),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", id),
    supabase
      .from("contacts")
      .select("id, company_name, phone, email, website_url, town, industry, status, updated_at")
      .eq("assigned_to", id)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("commission_rates")
      .select("rate")
      .eq("sales_person_id", id)
      .eq("commission_type", "website_sale")
      .maybeSingle(),
    fetchLastActiveFor(supabase, id),
  ]);

  const todayOutcomes: Record<string, number> = {};
  (todayLogs || []).forEach((l) => {
    todayOutcomes[l.outcome] = (todayOutcomes[l.outcome] || 0) + 1;
  });

  const weekOutcomes: Record<string, number> = {};
  (weekLogs || []).forEach((l) => {
    weekOutcomes[l.outcome] = (weekOutcomes[l.outcome] || 0) + 1;
  });

  const allOutcomes: Record<string, number> = {};
  let allCallsTotal = 0;
  for (const row of (allOutcomeRows ?? []) as { outcome: string; count: number }[]) {
    const n = Number(row.count);
    allOutcomes[row.outcome] = n;
    allCallsTotal += n;
  }

  const accepted = (proposals || []).filter(
    (p) => p.status === "accepted" || p.status === "paid",
  ).length;

  // Proposals "today / this week" count using created_at — mirrors the
  // call-count cards exactly. "Created" = salesperson submitted a proposal
  // to the tech team, which is what Peter means by "proposal request".
  const todayMs = todayStart.getTime();
  const weekMs = weekStart.getTime();
  let proposalsTodayCount = 0;
  let proposalsWeekCount = 0;
  for (const p of (proposals || []) as Array<{ created_at: string | null }>) {
    if (!p.created_at) continue;
    const t = new Date(p.created_at).getTime();
    if (t >= weekMs) proposalsWeekCount++;
    if (t >= todayMs) proposalsTodayCount++;
  }

  const outcomeKeys = [
    "no_answer",
    "not_exists",
    "not_interested",
    "send_proposal",
    "send_invoice",
    "send_email",
    "local_market",
    "never_contact",
    "callback",
  ];

  const active = lastActiveLabel(lastActiveIso);

  const commissionRate = rateRow ? Math.round(Number(rateRow.rate) * 100) : 10;

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — eyebrow + name + live activity status on the left,
          the commission-rate control sits in its own soft tile on the right.
          Commission is the "money" lever, so its chip gets the pink accent. */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sales overview
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            {person.full_name}
          </h1>
          <p className="text-sm">
            {active.isActive ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {active.label}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Last active {active.label}
              </span>
            )}
          </p>
        </div>
        <div className="dash-card flex w-full items-center gap-3 p-4 sm:w-auto">
          <span className="dash-chip-pink inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Percent className="h-4 w-4" />
          </span>
          <CommissionRateEditor
            salesPersonId={person.id}
            initialRate={commissionRate}
          />
        </div>
      </div>

      <SalespersonStats
        calls={{
          today: (todayLogs || []).length,
          week: (weekLogs || []).length,
          all: allCallsTotal,
        }}
        proposals={{
          today: proposalsTodayCount,
          week: proposalsWeekCount,
          all: (proposals || []).length,
        }}
        accepted={accepted}
      />

      {/* Call outcome breakdown — soft panel with an eyebrow header, matching the
          roster section on the sales-overview list. Operational data, so the
          icon chip stays violet. */}
      <section className="dash-panel overflow-hidden">
        <div className="dash-hairline flex items-center gap-2 border-b px-5 py-3.5">
          <BarChart3 className="dash-accent h-4 w-4" />
          <h2 className="text-xs font-semibold uppercase tracking-wider">
            Call outcome breakdown
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="dash-hairline border-b hover:bg-transparent">
              <TableHead className="py-3 pl-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Outcome
              </TableHead>
              <TableHead className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Today
              </TableHead>
              <TableHead className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                This week
              </TableHead>
              <TableHead className="py-3 pr-5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                All time
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outcomeKeys.map((key) => {
              const today = todayOutcomes[key] || 0;
              const week = weekOutcomes[key] || 0;
              const all = allOutcomes[key] || 0;
              if (all === 0 && week === 0) return null;
              return (
                <TableRow key={key} className="dash-row">
                  <TableCell className="py-3 pl-5">
                    <div className="flex items-center gap-2 text-sm">
                      {OUTCOME_ICONS[key]}
                      {OUTCOME_LABELS[key] || key}
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right tabular-nums">
                    {today || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-right tabular-nums">
                    {week || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-3 pr-5 text-right tabular-nums">
                    {all}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="dash-hairline border-t font-semibold hover:bg-transparent">
              <TableCell className="py-3 pl-5">Total</TableCell>
              <TableCell className="py-3 text-right tabular-nums">
                {(todayLogs || []).length}
              </TableCell>
              <TableCell className="py-3 text-right tabular-nums">
                {(weekLogs || []).length}
              </TableCell>
              <TableCell className="py-3 pr-5 text-right tabular-nums">
                {allCallsTotal}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Assigned contacts — soft panel with an eyebrow header carrying a live
          count badge, mirroring the roster table's treatment. The inner search
          + table component is unchanged. */}
      <section className="dash-panel overflow-hidden">
        <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Users className="dash-accent h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider">
              Assigned contacts
            </h2>
          </div>
          <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
            {assignedContacts ?? 0}
          </span>
        </div>
        <div className="pb-2 pt-3">
          <AssignedContactsTable
            contacts={contactsList || []}
            statusLabels={OUTCOME_LABELS}
          />
        </div>
      </section>
    </div>
  );
}
