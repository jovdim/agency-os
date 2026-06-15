import Link from "next/link";
import { Brand } from "@/components/brand";
import { LogoutButton } from "./logout-button";

/**
 * Shared top-nav chrome for the per-site /admin zone (overview, balance,
 * domain). Replaces the CRM dashboard shell's sidebar with a slim top bar +
 * the same destinations. The editor (/admin/edit) is full-bleed and uses its
 * own minimal chrome instead.
 */
const NAV: { href: string; label: string; key: string }[] = [
  { href: "/admin", label: "Dashboard", key: "dashboard" },
  { href: "/admin/edit", label: "Edit website", key: "edit" },
  { href: "/admin/balance", label: "Balance", key: "balance" },
  { href: "/admin/domain", label: "Domain", key: "domain" },
];

export function SiteAdminHeader({ active }: { active?: string }) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b dash-hairline bg-card/95 px-4 py-3 backdrop-blur sm:px-5">
      <div className="flex items-center gap-5">
        <Brand wordmarkClassName="h-7" />
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active === n.key
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <LogoutButton />
    </header>
  );
}
