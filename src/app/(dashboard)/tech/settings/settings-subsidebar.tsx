"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkle as Sparkles } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

/**
 * Left sub-sidebar shown inside `/tech/settings/*`. Lists every
 * settings category and highlights the current one based on URL.
 *
 * Add a new category by appending an entry to `SETTINGS_NAV` —
 * label, href, icon. The active-state highlight uses startsWith so
 * deeper sub-pages (e.g. `/tech/settings/ai/usage`) keep the parent
 * "AI" entry highlighted.
 *
 * Single category today (AI). Built as a list, not hardcoded, so
 * the very next setting we add (commissions, system, audit, etc.)
 * just slots in here.
 */

interface SettingsNavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  {
    label: "AI",
    href: "/tech/settings/ai",
    icon: <Sparkles className="h-4 w-4" />,
  },
];

export function SettingsSubsidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pb-2">
        Settings
      </p>
      <nav className="space-y-0.5">
        {SETTINGS_NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                active
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
