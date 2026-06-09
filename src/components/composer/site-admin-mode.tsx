"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Marks the composer as mounted inside a per-site CMS admin
 * (theirdomain.com/admin) whose user has NO Supabase session. Controls that
 * call CRM-only endpoints (AI generate, version history/revert, subdomain
 * editor, per-image AI) 401 for such a user, and some are destructive, so they
 * are hidden when this is true. Defaults to false everywhere, so the staff
 * composer is unaffected.
 *
 * In its own module (not composer-client.tsx) so deep children like
 * placeholder-field.tsx can read it without an import cycle.
 */
const SiteAdminModeContext = createContext<boolean>(false);

export function SiteAdminModeProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <SiteAdminModeContext.Provider value={value}>
      {children}
    </SiteAdminModeContext.Provider>
  );
}

export function useSiteAdminMode(): boolean {
  return useContext(SiteAdminModeContext);
}
