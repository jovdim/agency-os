"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogOut, TrendingUp, Info } from "lucide-react";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { UserRole } from "@/types/database";

interface CommissionData {
  total: number;
  count: number;
  rate: number;
  unpaid: number;
}

export function Topbar({
  userName,
  role,
}: {
  userName: string;
  role: UserRole;
}) {
  const router = useRouter();
  const [commission, setCommission] = useState<CommissionData | null>(null);

  // Fetch commission for sales role
  useEffect(() => {
    if (role !== "sales") return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      Promise.all([
        supabase
          .from("commissions")
          .select("amount, is_paid")
          .eq("sales_person_id", user.id),
        supabase
          .from("commission_rates")
          .select("rate")
          .eq("sales_person_id", user.id)
          .eq("commission_type", "website_sale")
          .maybeSingle(),
      ]).then(([{ data: commissions }, { data: rateRow }]) => {
        const all = commissions ?? [];
        const total = all.reduce((sum, c) => sum + Number(c.amount), 0);
        const unpaid = all.filter(c => !c.is_paid).reduce((sum, c) => sum + Number(c.amount), 0);
        setCommission({
          total,
          count: all.length,
          rate: rateRow ? Math.round(Number(rateRow.rate) * 100) : 10,
          unpaid,
        });
      });
    });
  }, [role]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{userName}</span>
        <Badge variant="secondary" className="text-xs">
          {ROLE_LABELS[role]}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {role === "sales" && commission !== null && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs mr-2 px-2.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
                <TrendingUp className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-muted-foreground">Commission:</span>
                <span className="font-semibold text-violet-600 dark:text-violet-400">${commission.total.toFixed(0)}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <div className="px-4 py-3 border-b">
                <h4 className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-violet-500" />
                  Your commission
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  You earn {commission.rate}% on every paid website
                </p>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total earned</span>
                  <span className="font-semibold text-violet-600 dark:text-violet-400">${commission.total.toFixed(0)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Number of commissions</span>
                  <span className="font-medium">{commission.count}</span>
                </div>
                {commission.unpaid > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">To be paid out</span>
                    <span className="font-medium text-amber-600">${commission.unpaid.toFixed(0)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Rate</span>
                  <Badge variant="secondary" className="text-[10px]">{commission.rate}%</Badge>
                </div>
              </div>
              <div className="px-4 py-2.5 border-t bg-muted/30">
                <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  Commission is credited automatically once the client&apos;s payment is confirmed.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        )}
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          <span className="sr-only">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
