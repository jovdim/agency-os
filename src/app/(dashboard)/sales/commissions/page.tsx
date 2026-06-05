import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { CurrencyDollar as DollarSign, TrendUp as TrendingUp, Clock, CheckCircle, Money as Banknote } from "@phosphor-icons/react/ssr";

export const dynamic = "force-dynamic";

export default async function CommissionsPage() {
  await requireRole("sales");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch all commissions for this sales person
  const { data: commissions } = await supabase
    .from("commissions")
    .select(
      "*, proposals(company_name, industry), payments(amount, created_at)",
    )
    .eq("sales_person_id", user!.id)
    .order("created_at", { ascending: false });

  const allCommissions = commissions || [];

  const totalEarned = allCommissions.reduce(
    (sum, c) => sum + Number(c.amount),
    0,
  );
  const paidCommissions = allCommissions.filter((c) => c.is_paid);
  const totalPaid = paidCommissions.reduce(
    (sum, c) => sum + Number(c.amount),
    0,
  );
  const pendingCommissions = allCommissions.filter((c) => !c.is_paid);
  const totalPending = pendingCommissions.reduce(
    (sum, c) => sum + Number(c.amount),
    0,
  );

  // This month's commissions
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const thisMonth = allCommissions.filter(
    (c) => new Date(c.created_at) >= startOfMonth,
  );
  const thisMonthTotal = thisMonth.reduce(
    (sum, c) => sum + Number(c.amount),
    0,
  );

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2 });

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Hero band — the page's single gradient surface. Title on the left, the
          focal Total Earned metric in a frosted inset on the right (the only
          pink hero chip — earnings are the good-news number). */}
      <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Earnings
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Commissions</h1>
          <p className="text-sm text-muted-foreground">
            Everything you&apos;ve earned across your closed proposals.
          </p>
        </div>

        <div className="dash-hero-metric flex items-center gap-4 px-5 py-4">
          <span className="dash-chip-pink inline-flex h-12 w-12 items-center justify-center rounded-xl">
            <TrendingUp className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total earned
            </p>
            <p className="text-3xl font-bold leading-tight tabular-nums">
              ${fmt(totalEarned)}
            </p>
            <p className="text-xs text-muted-foreground">
              across {allCommissions.length} commission
              {allCommissions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </section>

      {/* Stat tiles — Paid Out keeps the pink good-news accent; Pending and
          This Month stay operational violet. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="dash-card block p-5">
          <div className="flex items-center justify-between">
            <span className="dash-chip-pink inline-flex h-9 w-9 items-center justify-center rounded-lg">
              <CheckCircle className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums text-(--dash-accent-2)">
            ${fmt(totalPaid)}
          </p>
          <p className="mt-1 text-sm font-medium">Paid out</p>
          <p className="text-xs text-muted-foreground">
            {paidCommissions.length} commission
            {paidCommissions.length !== 1 ? "s" : ""} settled
          </p>
        </div>

        <div className="dash-card block p-5">
          <div className="flex items-center justify-between">
            <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums">
            ${fmt(totalPending)}
          </p>
          <p className="mt-1 text-sm font-medium">Pending</p>
          <p className="text-xs text-muted-foreground">
            {pendingCommissions.length} commission
            {pendingCommissions.length !== 1 ? "s" : ""} awaiting payout
          </p>
        </div>

        <div className="dash-card block p-5">
          <div className="flex items-center justify-between">
            <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums">
            ${fmt(thisMonthTotal)}
          </p>
          <p className="mt-1 text-sm font-medium">This month</p>
          <p className="text-xs text-muted-foreground">
            {thisMonth.length} commission{thisMonth.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Commission history — a dash-panel list section with header, and rows
          carrying an icon chip + title/desc + amount + status badge. */}
      <section className="dash-panel flex flex-col overflow-hidden">
        <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Banknote className="dash-accent h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider">
              Commission history
            </h2>
          </div>
          {allCommissions.length > 0 && (
            <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
              {allCommissions.length}
            </span>
          )}
        </div>

        {allCommissions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
            <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
              <DollarSign className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">No commissions yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Commissions will appear here when your proposals generate payments.
            </p>
          </div>
        ) : (
          <ul className="dash-hairline divide-y">
            {allCommissions.map((commission) => {
              const proposal = commission.proposals as {
                company_name: string;
                industry: string | null;
              } | null;

              return (
                <li
                  key={commission.id}
                  className="dash-row flex items-center gap-3 px-5 py-3.5"
                >
                  <span
                    className={`${commission.is_paid ? "dash-chip-pink" : "dash-chip"} inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}
                  >
                    {commission.is_paid ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {proposal?.company_name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {proposal?.industry || "General"} •{" "}
                      {new Date(commission.created_at).toLocaleDateString(
                        "en-US",
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-bold tabular-nums">
                      ${Number(commission.amount).toFixed(2)}
                    </span>
                    <Badge
                      variant="secondary"
                      className={
                        commission.is_paid
                          ? "bg-(--dash-accent-2)/12 text-(--dash-accent-2) border-transparent"
                          : "text-muted-foreground"
                      }
                    >
                      {commission.is_paid ? "Paid" : "Pending"}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
