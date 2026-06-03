import type { UserRole } from "@/types/database";

export const ROLE_LABELS: Record<UserRole, string> = {
  client: "Client",
  sales: "Sales",
  tech_admin: "Tech Admin",
  administrator: "Administrator",
  super_admin: "Super Admin",
};

const ROLE_HIERARCHY: Record<UserRole, number> = {
  client: 0,
  sales: 1,
  tech_admin: 2,
  administrator: 3,
  super_admin: 4,
};

/**
 * Route prefix to allowed roles mapping.
 * Super admin can access everything via hierarchy check.
 */
const ROUTE_ROLES: Record<string, UserRole[]> = {
  "/client": ["client", "super_admin"],
  "/sales": ["sales", "super_admin"],
  "/tech": ["tech_admin", "super_admin"],
  "/admin": ["administrator", "super_admin"],
  "/super": ["super_admin"],
};

export function hasMinRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function canAccessRoute(userRole: UserRole, pathname: string): boolean {
  for (const [prefix, allowedRoles] of Object.entries(ROUTE_ROLES)) {
    if (pathname.startsWith(prefix)) {
      return allowedRoles.includes(userRole);
    }
  }
  return true; // Allow access to routes not in the mapping
}

export function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case "client":
      return "/client";
    case "sales":
      return "/sales";
    case "tech_admin":
      return "/tech";
    case "administrator":
      return "/admin";
    case "super_admin":
      return "/super";
    default:
      return "/login";
  }
}

export function getRoleFromJwt(jwt: Record<string, unknown>): UserRole | null {
  const role = jwt?.user_role as string | undefined;
  if (role && role in ROLE_HIERARCHY) {
    return role as UserRole;
  }
  return null;
}
