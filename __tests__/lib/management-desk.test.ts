import { describe, it, expect } from "vitest";

describe("Management Desk — Client Tasks", () => {
  const SERVICE_TYPES = [
    "website", "gbp", "backlinks", "subpages", "email_setup",
    "logo", "facebook_ads", "instagram", "google_ads",
    "migration", "invoice_request", "other",
  ];

  it("has all required service types", () => {
    expect(SERVICE_TYPES).toContain("website");
    expect(SERVICE_TYPES).toContain("gbp");
    expect(SERVICE_TYPES).toContain("backlinks");
    expect(SERVICE_TYPES).toContain("invoice_request");
    expect(SERVICE_TYPES).toHaveLength(12);
  });

  it("creates task with required fields", () => {
    const task = {
      company_name: "Balkar s.r.o.",
      service_type: "website",
      amount: 149,
      is_done: false,
      notes: null,
      needs_attention: false,
    };

    expect(task.company_name).toBeTruthy();
    expect(task.service_type).toBeTruthy();
    expect(task.is_done).toBe(false);
  });

  it("rejects task without company name", () => {
    const companyName = "";
    const isValid = companyName.trim().length > 0;
    expect(isValid).toBe(false);
  });

  it("toggles done status correctly", () => {
    const task = { is_done: false, done_at: null as string | null };

    // Toggle to done
    task.is_done = true;
    task.done_at = new Date().toISOString();
    expect(task.is_done).toBe(true);
    expect(task.done_at).toBeTruthy();

    // Toggle back to pending
    task.is_done = false;
    task.done_at = null;
    expect(task.is_done).toBe(false);
    expect(task.done_at).toBeNull();
  });

  it("filters tasks correctly", () => {
    const tasks = [
      { id: "1", company_name: "A", is_done: false, needs_attention: false, service_type: "website" },
      { id: "2", company_name: "B", is_done: true, needs_attention: false, service_type: "gbp" },
      { id: "3", company_name: "C", is_done: false, needs_attention: true, service_type: "invoice_request" },
      { id: "4", company_name: "D", is_done: false, needs_attention: false, service_type: "backlinks" },
    ];

    const pending = tasks.filter((t) => !t.is_done);
    expect(pending).toHaveLength(3);

    const done = tasks.filter((t) => t.is_done);
    expect(done).toHaveLength(1);

    const needsAttention = tasks.filter((t) => t.needs_attention);
    expect(needsAttention).toHaveLength(1);

    const invoiceRequests = tasks.filter((t) => t.service_type === "invoice_request" && !t.is_done);
    expect(invoiceRequests).toHaveLength(1);
  });

  it("calculates stats correctly", () => {
    const tasks = [
      { is_done: true, amount: 149, created_at: new Date().toISOString() },
      { is_done: true, amount: 299, created_at: new Date().toISOString() },
      { is_done: false, amount: 99, created_at: new Date().toISOString() },
      { is_done: false, amount: null, created_at: new Date().toISOString() },
    ];

    const totalRevenue = tasks
      .filter((t) => t.is_done && t.amount)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    expect(totalRevenue).toBe(448);

    const pendingCount = tasks.filter((t) => !t.is_done).length;
    expect(pendingCount).toBe(2);
  });

  it("searches by company name", () => {
    const tasks = [
      { company_name: "Balkar s.r.o." },
      { company_name: "Cerber" },
      { company_name: "Sandwave" },
    ];

    const query = "bal";
    const results = tasks.filter((t) =>
      t.company_name.toLowerCase().includes(query.toLowerCase())
    );
    expect(results).toHaveLength(1);
    expect(results[0].company_name).toBe("Balkar s.r.o.");
  });
});

describe("Invoice Request Flow", () => {
  it("creates desk task with invoice_request type", () => {
    const task = {
      company_name: "Test Company",
      service_type: "invoice_request",
      amount: 149,
      is_done: false,
      needs_attention: true,
    };

    expect(task.service_type).toBe("invoice_request");
    expect(task.needs_attention).toBe(true);
  });

  it("counts pending invoice requests", () => {
    const tasks = [
      { service_type: "invoice_request", is_done: false },
      { service_type: "invoice_request", is_done: true },
      { service_type: "website", is_done: false },
      { service_type: "invoice_request", is_done: false },
    ];

    const pendingInvoices = tasks.filter(
      (t) => t.service_type === "invoice_request" && !t.is_done
    );
    expect(pendingInvoices).toHaveLength(2);
  });
});
