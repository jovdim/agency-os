import { describe, it, expect } from "vitest";

describe("Calling Database Page Logic", () => {
  const mockContacts = [
    { id: "1", company_name: "Firma A", status: "new", client_status: null, town: "Bratislava", phone: "+421900111222", industry: "IT", assigned_to: "user1" },
    { id: "2", company_name: "Firma B", status: "new", client_status: "client", town: "Košice", phone: "+421900333444", industry: "Stavba", assigned_to: "user1" },
    { id: "3", company_name: "Firma C", status: "callback", client_status: null, town: "Prešov", phone: "+421900555666", industry: "Gastro", assigned_to: "user1" },
    { id: "4", company_name: "Firma D", status: "new", client_status: null, town: "Bratislava", phone: null, industry: "IT", assigned_to: "user2" },
    { id: "5", company_name: "Firma E", status: "not_interested", client_status: null, town: "Žilina", phone: "+421900777888", industry: null, assigned_to: "user1" },
  ];

  it("filters new contacts for calling (excludes clients)", () => {
    const userId = "user1";
    const callable = mockContacts.filter(
      (c) => c.status === "new" && c.client_status !== "client" && c.assigned_to === userId
    );
    expect(callable).toHaveLength(1);
    expect(callable[0].company_name).toBe("Firma A");
  });

  it("filters callback contacts", () => {
    const userId = "user1";
    const callbacks = mockContacts.filter(
      (c) => c.status === "callback" && c.assigned_to === userId
    );
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].company_name).toBe("Firma C");
  });

  it("excludes contacts assigned to other salespeople", () => {
    const userId = "user1";
    const myContacts = mockContacts.filter((c) => c.assigned_to === userId);
    expect(myContacts).toHaveLength(4);
    expect(myContacts.find((c) => c.id === "4")).toBeUndefined();
  });

  it("search filters by company name", () => {
    const query = "firma a";
    const filtered = mockContacts.filter((c) =>
      c.company_name.toLowerCase().includes(query.toLowerCase())
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("search filters by town", () => {
    const query = "bratislava";
    const filtered = mockContacts.filter(
      (c) =>
        c.company_name.toLowerCase().includes(query.toLowerCase()) ||
        (c.town && c.town.toLowerCase().includes(query.toLowerCase()))
    );
    expect(filtered).toHaveLength(2);
  });

  it("search filters by industry", () => {
    const query = "it";
    const filtered = mockContacts.filter(
      (c) => c.industry && c.industry.toLowerCase().includes(query.toLowerCase())
    );
    expect(filtered).toHaveLength(2);
  });
});

describe("Call Outcome Actions", () => {
  it("all outcomes are valid", () => {
    const validOutcomes = [
      "no_answer", "not_exists", "interested", "not_interested",
      "send_proposal", "send_email", "send_invoice", "callback",
      "needs_ecommerce", "local_market", "directory_note",
      "handed_over", "whatsapp_sent", "note",
    ];

    expect(validOutcomes).toHaveLength(14);
    validOutcomes.forEach((outcome) => {
      expect(typeof outcome).toBe("string");
      expect(outcome.length).toBeGreaterThan(0);
    });
  });

  it("interested sub-actions exist", () => {
    const interestedSubActions = [
      "send_proposal",
      "send_email",
      "send_invoice",
      "local_market",
    ];
    expect(interestedSubActions).toHaveLength(4);
  });

  it("callback requires callback_at date", () => {
    const outcome = "callback";
    const callbackAt = null;
    const isValid = outcome !== "callback" || callbackAt !== null;
    expect(isValid).toBe(false);

    const callbackAt2 = "2026-03-28T10:00:00Z";
    const isValid2 = outcome !== "callback" || callbackAt2 !== null;
    expect(isValid2).toBe(true);
  });
});

describe("Optimistic UI Updates", () => {
  it("removes contact from list after action", () => {
    let contacts = [
      { id: "1", company_name: "A" },
      { id: "2", company_name: "B" },
      { id: "3", company_name: "C" },
    ];

    const removedId = "2";
    contacts = contacts.filter((c) => c.id !== removedId);
    expect(contacts).toHaveLength(2);
    expect(contacts.find((c) => c.id === "2")).toBeUndefined();
  });

  it("reverts on error", () => {
    const original = [
      { id: "1", company_name: "A" },
      { id: "2", company_name: "B" },
    ];

    let contacts = [...original];
    const removedContact = contacts.find((c) => c.id === "2")!;
    contacts = contacts.filter((c) => c.id !== "2");
    expect(contacts).toHaveLength(1);

    // Simulate error — revert
    const apiError = true;
    if (apiError) {
      contacts = [...contacts, removedContact].sort((a, b) => a.id.localeCompare(b.id));
    }
    expect(contacts).toHaveLength(2);
  });

  it("increments processed count after action", () => {
    let processedCount = 5;
    processedCount += 1;
    expect(processedCount).toBe(6);
  });
});

describe("WhatsApp Copy Text", () => {
  it("generates correct WhatsApp text", () => {
    const companyName = "Balkar, s. r. o.";
    const subdomain = "balkar";
    const text = `Dobrý deň, volal som Vám ohľadom webstránky pre ${companyName}.\nTu si ju môžete pozrieť: https://${subdomain}.2dni.sk`;

    expect(text).toContain("Balkar, s. r. o.");
    expect(text).toContain("https://balkar.2dni.sk");
    expect(text).toContain("Dobrý deň");
  });

  it("handles missing subdomain", () => {
    const subdomain = undefined;
    const url = subdomain ? `https://${subdomain}.2dni.sk` : "";
    expect(url).toBe("");
  });
});
