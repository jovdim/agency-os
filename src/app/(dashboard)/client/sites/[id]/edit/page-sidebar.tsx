"use client";

import { House as Home, SidebarSimple as PanelLeftClose, Sidebar as PanelLeftOpen, FileText, SignOut as LogOut, ArrowLeft } from "@phosphor-icons/react/ssr";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InlineChange } from "./changes-panel";

export interface PageInfo {
  path: string;
  label: string;
}

interface PageSidebarProps {
  pages: PageInfo[];
  activePage: string;
  onPageSelect: (path: string) => void;
  isLoading: boolean;
  pendingChanges: InlineChange[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function PageSidebar({
  pages,
  activePage,
  onPageSelect,
  isLoading,
  pendingChanges,
  collapsed,
  onToggleCollapse,
}: PageSidebarProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (!confirm("Are you sure you want to log out?")) return;
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }
  // Keep pages in DOM order (as they appear in the website nav)
  const sorted = pages;

  // Collapsed state — thin strip with expand button
  if (collapsed) {
    return (
      <div className="w-9 shrink-0 border-r dash-hairline bg-card flex flex-col items-center py-3">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Show pages"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <div className="mt-3 inline-flex items-center justify-center w-6 h-6 rounded-md dash-chip">
          <FileText className="w-3.5 h-3.5" />
        </div>
        <span className="text-[9px] text-muted-foreground mt-1.5 tabular-nums writing-mode-vertical" style={{ writingMode: "vertical-rl" }}>
          {pages.length} {pages.length === 1 ? "page" : "pages"}
        </span>
      </div>
    );
  }

  return (
    <div className="w-56 shrink-0 border-r dash-hairline bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b dash-hairline dash-subhead">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Pages
        </span>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Hide"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Page list */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {isLoading ? (
            <div className="space-y-1 px-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded-lg bg-secondary/50 animate-pulse" />
              ))}
            </div>
          ) : (
            sorted.map((page) => {
              const isActive = activePage === page.path;
              const hasChanges = pendingChanges.some((c) => c.file_path === page.path);
              const isHome = page.path === "index.html";

              return (
                <button
                  key={page.path}
                  onClick={() => onPageSelect(page.path)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                    isActive
                      ? "bg-(--dash-chip-bg) dash-accent font-medium"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                  title={page.label}
                >
                  {isHome ? (
                    <Home className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <span className="text-muted-foreground/40 shrink-0">/</span>
                  )}
                  <span className="leading-tight wrap-break-word">{page.label}</span>
                  {hasChanges && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-(--dash-accent-2) shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Bottom actions */}
      <div className="border-t dash-hairline p-1.5 space-y-0.5">
        <button
          onClick={() => router.push("/client")}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          Home
        </button>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          {loggingOut ? "Logging out..." : "Log out"}
        </button>
      </div>
    </div>
  );
}
