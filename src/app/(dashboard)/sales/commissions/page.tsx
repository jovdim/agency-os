import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  Banknote,
} from "lucide-react";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Commissions</h1>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${totalEarned.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Paid Out</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              ${totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              ${totalPending.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">
              {pendingCommissions.length} commission
              {pendingCommissions.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${thisMonthTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">
              {thisMonth.length} commission{thisMonth.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Commission history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            Commission History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allCommissions.length === 0 ? (
            <div className="py-12 text-center">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No commissions yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Commissions will appear here when your proposals generate
                payments.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {allCommissions.map((commission) => {
                const proposal = commission.proposals as {
                  company_name: string;
                  industry: string | null;
                } | null;

                return (
                  <div
                    key={commission.id}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {proposal?.company_name || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {proposal?.industry || "General"} •{" "}
                        {new Date(commission.created_at).toLocaleDateString(
                          "en-US",
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <span className="text-sm font-bold">
                        ${Number(commission.amount).toFixed(2)}
                      </span>
                      <Badge
                        variant={commission.is_paid ? "default" : "secondary"}
                        className={
                          commission.is_paid
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                            : "bg-yellow-500/15 text-yellow-600 border-yellow-500/30"
                        }
                      >
                        {commission.is_paid ? "Paid" : "Pending"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
