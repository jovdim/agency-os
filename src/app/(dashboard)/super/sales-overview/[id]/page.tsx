import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLastActiveFor, lastActiveLabel } from "@/lib/auth/last-active";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { CommissionRateEditor } from "./commission-rate-editor";

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
      .select("id, company_name, phone, email, website_url, town, district, industry, status, updated_at")
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{person.full_name}</h1>
          <p className="text-sm mt-0.5">
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
        <CommissionRateEditor
          salesPersonId={person.id}
          initialRate={commissionRate}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">
              {(todayLogs || []).length}
            </p>
            <p className="text-xs text-muted-foreground">Calls today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">
              {(weekLogs || []).length}
            </p>
            <p className="text-xs text-muted-foreground">Calls this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">
              {allCallsTotal}
            </p>
            <p className="text-xs text-muted-foreground">Calls all time</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">
              {(proposals || []).length}
            </p>
            <p className="text-xs text-muted-foreground">
              Proposals ({accepted} accepted)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">
              {proposalsTodayCount}
            </p>
            <p className="text-xs text-muted-foreground">Proposals today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold tabular-nums">
              {proposalsWeekCount}
            </p>
            <p className="text-xs text-muted-foreground">Proposals this week</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Call outcome breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">This week</TableHead>
                <TableHead className="text-right">All time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outcomeKeys.map((key) => {
                const today = todayOutcomes[key] || 0;
                const week = weekOutcomes[key] || 0;
                const all = allOutcomes[key] || 0;
                if (all === 0 && week === 0) return null;
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        {OUTCOME_ICONS[key]}
                        {OUTCOME_LABELS[key] || key}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {today || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {week || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{all}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {(todayLogs || []).length}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(weekLogs || []).length}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {allCallsTotal}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Assigned contacts ({assignedContacts ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Website</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(contactsList || []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground text-sm"
                  >
                    No contacts assigned
                  </TableCell>
                </TableRow>
              ) : (
                (contactsList || []).map((c) => (
                  <TableRow key={c.id} className="text-xs">
                    <TableCell>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {OUTCOME_LABELS[c.status] || c.status}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium truncate max-w-48">
                      {c.company_name}
                    </TableCell>
                    <TableCell>
                      {c.town || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          className="hover:underline"
                        >
                          {c.phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.industry || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.email || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.website_url ? (
                        <a
                          href={c.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline truncate max-w-24 block"
                        >
                          {c.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
