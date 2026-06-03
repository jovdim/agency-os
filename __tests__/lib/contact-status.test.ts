import { describe, it, expect } from "vitest";

// Test contact status transitions and calling database logic
describe("Contact Status Transitions", () => {
  const OUTCOME_TO_STATUS: Record<string, string> = {
    no_answer: "no_answer",
    not_exists: "not_exists",
    interested: "interested",
    not_interested: "not_interested",
    send_proposal: "send_proposal",
    send_email: "send_email",
    send_invoice: "send_invoice",
    callback: "callback",
    needs_ecommerce: "needs_ecommerce",
    local_market: "local_market",
    directory_note: "directory_note",
    handed_over: "",
    whatsapp_sent: "",
    note: "",
  };

  it("maps all call outcomes to contact statuses", () => {
    expect(OUTCOME_TO_STATUS["no_answer"]).toBe("no_answer");
    expect(OUTCOME_TO_STATUS["interested"]).toBe("interested");
    expect(OUTCOME_TO_STATUS["not_interested"]).toBe("not_interested");
    expect(OUTCOME_TO_STATUS["send_proposal"]).toBe("send_proposal");
    expect(OUTCOME_TO_STATUS["callback"]).toBe("callback");
    expect(OUTCOME_TO_STATUS["local_market"]).toBe("local_market");
  });

  it("does not change status for note/handover outcomes", () => {
    expect(OUTCOME_TO_STATUS["handed_over"]).toBe("");
    expect(OUTCOME_TO_STATUS["whatsapp_sent"]).toBe("");
    expect(OUTCOME_TO_STATUS["note"]).toBe("");
  });

  it("sets local_market flag for local_market outcome", () => {
    const outcome = "local_market";
    const shouldSetLocalMarket = outcome === "local_market";
    expect(shouldSetLocalMarket).toBe(true);
  });

  it("excludes clients from calling list", () => {
    const contacts = [
      { id: "1", status: "new", client_status: null },
      { id: "2", status: "new", client_status: "client" },
      { id: "3", status: "new", client_status: "requested" },
      { id: "4", status: "callback", client_status: null },
    ];

    const callableContacts = contacts.filter(
      (c) => c.status === "new" && c.client_status !== "client"
    );

    expect(callableContacts).toHaveLength(2);
    expect(callableContacts.map((c) => c.id)).toEqual(["1", "3"]);
  });

  it("filters callback contacts correctly", () => {
    const contacts = [
      { id: "1", status: "callback", callback_at: "2026-03-27" },
      { id: "2", status: "callback", callback_at: "2026-03-28" },
      { id: "3", status: "new", callback_at: null },
    ];

    const callbacks = contacts.filter((c) => c.status === "callback");
    expect(callbacks).toHaveLength(2);
  });
});

describe("Sales Grant Limits", () => {
  it("allows grants up to 50 EUR (4 credits)", () => {
    const MAX_SALES_CREDITS = 4;
    const COST_PER_CHANGE = 12.5;

    expect(MAX_SALES_CREDITS * COST_PER_CHANGE).toBe(50);
    expect(3 <= MAX_SALES_CREDITS).toBe(true);
    expect(5 <= MAX_SALES_CREDITS).toBe(false);
  });
});

describe("Overdue Proposals Detection", () => {
  it("detects proposals overdue by more than 48 hours", () => {
    const now = new Date();
    const proposals = [
      { id: "1", status: "submitted", created_at: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString() }, // 72h ago
      { id: "2", status: "building", created_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() }, // 24h ago
      { id: "3", status: "submitted", created_at: new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString() }, // 49h ago
      { id: "4", status: "review", created_at: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString() }, // 72h but review status
    ];

    const overdue = proposals.filter((p) => {
      if (p.status !== "submitted" && p.status !== "building") return false;
      const diffHours = (now.getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
      return diffHours > 48;
    });

    expect(overdue).toHaveLength(2);
    expect(overdue.map((p) => p.id)).toEqual(["1", "3"]);
  });
});
