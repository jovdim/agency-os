import { describe, it, expect } from "vitest";

// Test price computation logic
describe("Proposal Price Utils", () => {
  const COST_PER_CHANGE = 12.5;

  it("calculates active price during discount window", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    const discountPrice = 149;
    const basePrice = 299;

    const isDiscountActive = now < expiresAt;
    const activePrice = isDiscountActive ? discountPrice : basePrice;

    expect(activePrice).toBe(149);
    expect(isDiscountActive).toBe(true);
  });

  it("calculates active price after discount expires", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
    const discountPrice = 149;
    const basePrice = 299;

    const isDiscountActive = now < expiresAt;
    const activePrice = isDiscountActive ? discountPrice : basePrice;

    expect(activePrice).toBe(299);
    expect(isDiscountActive).toBe(false);
  });

  it("calculates days remaining in discount window", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    expect(daysRemaining).toBe(5);
  });

  it("converts credits to EUR correctly", () => {
    expect(1 * COST_PER_CHANGE).toBe(12.5);
    expect(2 * COST_PER_CHANGE).toBe(25);
    expect(4 * COST_PER_CHANGE).toBe(50);
    expect(6 * COST_PER_CHANGE).toBe(75);
    expect(8 * COST_PER_CHANGE).toBe(100);
    expect(16 * COST_PER_CHANGE).toBe(200);
  });

  it("calculates EUR presets correctly", () => {
    const presets = [25, 50, 75, 100, 200];
    const creditsPerPreset = presets.map((eur) =>
      Math.floor(eur / COST_PER_CHANGE)
    );
    expect(creditsPerPreset).toEqual([2, 4, 6, 8, 16]);
  });
});

describe("Variable Symbol Generation", () => {
  it("generates 10-digit variable symbol", () => {
    const timestamp = Date.now();
    const vs = String(timestamp).slice(-10);
    expect(vs.length).toBe(10);
    expect(/^\d+$/.test(vs)).toBe(true);
  });

  it("generates unique variable symbols", () => {
    const symbols = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const vs = String(Date.now() + i).slice(-10);
      symbols.add(vs);
    }
    expect(symbols.size).toBe(100);
  });
});

describe("Commission Calculation", () => {
  it("calculates 10% commission correctly", () => {
    const amount = 149;
    const rate = 0.1;
    const commission = Math.round(amount * rate * 100) / 100;
    expect(commission).toBe(14.9);
  });

  it("calculates 15% commission correctly", () => {
    const amount = 299;
    const rate = 0.15;
    const commission = Math.round(amount * rate * 100) / 100;
    expect(commission).toBe(44.85);
  });

  it("handles zero amount", () => {
    const amount = 0;
    const rate = 0.1;
    const commission = Math.round(amount * rate * 100) / 100;
    expect(commission).toBe(0);
  });
});
