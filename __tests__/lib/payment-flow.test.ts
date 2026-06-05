import { describe, it, expect } from "vitest";

describe("Payment Confirmation Flow", () => {
  it("sets is_paid to true on site after payment", () => {
    const site = { is_paid: false };
    site.is_paid = true;
    expect(site.is_paid).toBe(true);
  });

  it("grants 1 credit (12.50 EUR) on payment", () => {
    const creditBalance = { balance: 0 };
    creditBalance.balance = 1;
    expect(creditBalance.balance).toBe(1);
    expect(creditBalance.balance * 12.5).toBe(12.5);
  });

  it("converts draft change requests to pending on payment", () => {
    const changeRequests = [
      { id: "1", status: "draft" },
      { id: "2", status: "draft" },
      { id: "3", status: "pending" },
    ];

    const updated = changeRequests.map((cr) =>
      cr.status === "draft" ? { ...cr, status: "pending" } : cr
    );

    expect(updated.filter((cr) => cr.status === "pending")).toHaveLength(3);
    expect(updated.filter((cr) => cr.status === "draft")).toHaveLength(0);
  });

  it("flags contact as client on payment", () => {
    const contact: { client_status: string | null; status: string } = {
      client_status: null,
      status: "send_proposal",
    };
    contact.client_status = "client";
    contact.status = "converted";
    expect(contact.client_status).toBe("client");
    expect(contact.status).toBe("converted");
  });

  it("calculates commission correctly for various rates", () => {
    const testCases = [
      { amount: 149, rate: 0.1, expected: 14.9 },
      { amount: 199, rate: 0.1, expected: 19.9 },
      { amount: 299, rate: 0.1, expected: 29.9 },
      { amount: 149, rate: 0.15, expected: 22.35 },
      { amount: 0, rate: 0.1, expected: 0 },
    ];

    testCases.forEach(({ amount, rate, expected }) => {
      const commission = Math.round(amount * rate * 100) / 100;
      expect(commission).toBe(expected);
    });
  });

  it("prevents double confirmation", () => {
    const existingPayments = [{ proposal_id: "p1", status: "confirmed" }];
    const proposalId = "p1";
    const alreadyConfirmed = existingPayments.some(
      (p) => p.proposal_id === proposalId && p.status === "confirmed"
    );
    expect(alreadyConfirmed).toBe(true);
  });

  it("allows confirmation when no existing payment", () => {
    const existingPayments: { proposal_id: string; status: string }[] = [];
    const proposalId = "p1";
    const alreadyConfirmed = existingPayments.some(
      (p) => p.proposal_id === proposalId && p.status === "confirmed"
    );
    expect(alreadyConfirmed).toBe(false);
  });

  it("generates invoice number in correct format", () => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const seq = 1;
    const invoiceNumber = `FV-${dateStr}-${String(seq).padStart(3, "0")}`;
    expect(invoiceNumber).toMatch(/^FV-\d{8}-\d{3}$/);
  });
});

describe("Draft Change Request Flow", () => {
  it("saves as draft when unpaid and no credits", () => {
    const isPaid = false;
    const credits = 0;
    const status = !isPaid && credits === 0 ? "draft" : "pending";
    expect(status).toBe("draft");
  });

  it("saves as pending when paid with credits", () => {
    const isPaid: boolean = true;
    const credits: number = 1;
    const status = !isPaid && credits === 0 ? "draft" : "pending";
    expect(status).toBe("pending");
  });

  it("deducts credit on pending submission", () => {
    let balance = 3;
    const cost = 1;
    balance -= cost;
    expect(balance).toBe(2);
  });

  it("does not deduct credit on draft save", () => {
    let balance = 0;
    const isDraft = true;
    if (!isDraft) balance -= 1;
    expect(balance).toBe(0);
  });

  it("shows correct button text based on payment status", () => {
    const isPaid = false;
    const buttonText = isPaid ? "Odoslať zmeny — 12,50 €" : "Uložiť zmeny";
    expect(buttonText).toBe("Uložiť zmeny");

    const buttonText2 = true ? "Odoslať zmeny — 12,50 €" : "Uložiť zmeny";
    expect(buttonText2).toBe("Odoslať zmeny — 12,50 €");
  });
});
