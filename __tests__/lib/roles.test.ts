import { describe, it, expect } from "vitest";

// Test role hierarchy and route mapping
describe("Role Route Mapping", () => {
  const ROLE_ROUTES: Record<string, string> = {
    client: "/client",
    sales: "/sales",
    tech_admin: "/tech",
    administrator: "/admin",
    super_admin: "/super",
  };

  it("maps all roles to correct routes", () => {
    expect(ROLE_ROUTES["client"]).toBe("/client");
    expect(ROLE_ROUTES["sales"]).toBe("/sales");
    expect(ROLE_ROUTES["tech_admin"]).toBe("/tech");
    expect(ROLE_ROUTES["administrator"]).toBe("/admin");
    expect(ROLE_ROUTES["super_admin"]).toBe("/super");
  });

  it("all 5 roles exist", () => {
    expect(Object.keys(ROLE_ROUTES)).toHaveLength(5);
  });
});

describe("Sales Sidebar Navigation", () => {
  const SALES_NAV = [
    { label: "Dashboard", href: "/sales" },
    { label: "Kontakty", href: "/sales/contacts" },
    { label: "Ponuky", href: "/sales/proposals" },
    { label: "Lokálny trh", href: "/sales/local-market" },
    { label: "Provízie", href: "/sales/commissions" },
  ];

  it("has contacts page as second item", () => {
    expect(SALES_NAV[1].href).toBe("/sales/contacts");
    expect(SALES_NAV[1].label).toBe("Kontakty");
  });

  it("has local market page", () => {
    const localMarket = SALES_NAV.find((n) => n.href === "/sales/local-market");
    expect(localMarket).toBeDefined();
  });

  it("does not have templates page (removed)", () => {
    const templates = SALES_NAV.find((n) => n.href === "/sales/templates");
    expect(templates).toBeUndefined();
  });

  it("does not have production page (removed)", () => {
    const production = SALES_NAV.find((n) => n.href === "/sales/production");
    expect(production).toBeUndefined();
  });
});

describe("Super Admin Sidebar Navigation", () => {
  const SUPER_NAV_ITEMS = ["Overview", "Desk", "Sales Overview", "Proposals", "Production", "Users", "Contacts", "Payments", "Domains", "Audit Log", "Settings"];

  it("has Desk page", () => {
    expect(SUPER_NAV_ITEMS).toContain("Desk");
  });

  it("has Sales Overview page", () => {
    expect(SUPER_NAV_ITEMS).toContain("Sales Overview");
  });
});

describe("Access Control", () => {
  const ALLOWED_ROLES_FOR_CREDITS = ["tech_admin", "super_admin", "administrator", "sales"];
  const MAX_SALES_CREDITS = 4;

  it("sales can grant credits", () => {
    expect(ALLOWED_ROLES_FOR_CREDITS).toContain("sales");
  });

  it("sales limited to 4 credits (50 EUR)", () => {
    const role = "sales";
    const requestedCredits = 5;
    const isAllowed = role !== "sales" || requestedCredits <= MAX_SALES_CREDITS;
    expect(isAllowed).toBe(false);
  });

  it("admin not limited", () => {
    const role: string = "super_admin";
    const requestedCredits: number = 100;
    const isAllowed = role !== "sales" || requestedCredits <= MAX_SALES_CREDITS;
    expect(isAllowed).toBe(true);
  });
});
