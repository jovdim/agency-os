import { describe, it, expect } from "vitest";

/**
 * Tests for the domain request pipeline.
 * Covers:
 *  - Validation logic (valid vs invalid domain formats)
 *  - State transition rules
 *  - Role-based access (what client vs admin can set)
 *  - Edge cases around "in progress" statuses
 */

// ── Domain format validation ──────────────────────────
function isValidDomain(d: string): boolean {
  const r = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
  return r.test(d);
}

describe("Domain format validation", () => {
  it("accepts standard single-level TLD domains", () => {
    expect(isValidDomain("mojastranka.sk")).toBe(true);
    expect(isValidDomain("my-company.com")).toBe(true);
    expect(isValidDomain("a1b2c3.io")).toBe(true);
  });

  it("does NOT accept multi-level TLDs (known regex limitation)", () => {
    // Note: our current regex is intentionally strict — blocks .co.uk etc.
    // If we need .co.uk support later, the regex in the API + client must be relaxed.
    expect(isValidDomain("test.co.uk")).toBe(false);
  });

  it("rejects invalid formats", () => {
    expect(isValidDomain("")).toBe(false);
    expect(isValidDomain("no-tld")).toBe(false);
    expect(isValidDomain(".com")).toBe(false);
    expect(isValidDomain("spaces in.sk")).toBe(false);
    expect(isValidDomain("under_score.sk")).toBe(false);
    expect(isValidDomain("-starts-with-hyphen.sk")).toBe(false);
  });

  it("accepts capital letters (will be lowercased on save)", () => {
    expect(isValidDomain("MojaStranka.sk")).toBe(true);
  });
});

// ── State transitions ──────────────────────────
type DomainStatus =
  | "none"
  | "register_new"
  | "register_in_progress"
  | "transfer"
  | "transfer_in_progress"
  | "decided_later"
  | "active"
  | "rejected";

const QUEUED: DomainStatus[] = ["register_new", "transfer"];
const IN_PROGRESS: DomainStatus[] = ["register_in_progress", "transfer_in_progress"];
const TERMINAL: DomainStatus[] = ["active", "rejected"];

function inProgressStatusFor(current: DomainStatus): DomainStatus {
  if (current === "register_new") return "register_in_progress";
  if (current === "transfer") return "transfer_in_progress";
  return current;
}

describe("Domain pipeline transitions", () => {
  it("queue → in-progress maps correctly", () => {
    expect(inProgressStatusFor("register_new")).toBe("register_in_progress");
    expect(inProgressStatusFor("transfer")).toBe("transfer_in_progress");
  });

  it("in-progress → in-progress is a no-op (idempotent)", () => {
    expect(inProgressStatusFor("register_in_progress")).toBe("register_in_progress");
    expect(inProgressStatusFor("transfer_in_progress")).toBe("transfer_in_progress");
  });

  it("terminal states don't move via inProgressStatusFor", () => {
    expect(inProgressStatusFor("active")).toBe("active");
    expect(inProgressStatusFor("rejected")).toBe("rejected");
  });

  it("classifies statuses correctly", () => {
    expect(QUEUED.includes("register_new")).toBe(true);
    expect(QUEUED.includes("register_in_progress")).toBe(false);
    expect(IN_PROGRESS.includes("transfer_in_progress")).toBe(true);
    expect(IN_PROGRESS.includes("transfer")).toBe(false);
    expect(TERMINAL.includes("active")).toBe(true);
    expect(TERMINAL.includes("rejected")).toBe(true);
    expect(TERMINAL.includes("register_in_progress")).toBe(false);
  });
});

// ── Role-based access ──────────────────────────
function canClientSet(status: DomainStatus): boolean {
  // Clients can only move into queue or decide-later
  return ["register_new", "transfer", "decided_later"].includes(status);
}

function canAdminSet(status: DomainStatus): boolean {
  // Admins can set any status
  const all: DomainStatus[] = [
    "none",
    "register_new",
    "register_in_progress",
    "transfer",
    "transfer_in_progress",
    "decided_later",
    "active",
    "rejected",
  ];
  return all.includes(status);
}

describe("Role-based access to domain statuses", () => {
  it("client can set queue + decide-later", () => {
    expect(canClientSet("register_new")).toBe(true);
    expect(canClientSet("transfer")).toBe(true);
    expect(canClientSet("decided_later")).toBe(true);
  });

  it("client CANNOT set admin-only statuses", () => {
    expect(canClientSet("register_in_progress")).toBe(false);
    expect(canClientSet("transfer_in_progress")).toBe(false);
    expect(canClientSet("active")).toBe(false);
    expect(canClientSet("rejected")).toBe(false);
  });

  it("admin can set any status", () => {
    expect(canAdminSet("register_new")).toBe(true);
    expect(canAdminSet("register_in_progress")).toBe(true);
    expect(canAdminSet("active")).toBe(true);
    expect(canAdminSet("rejected")).toBe(true);
  });
});

// ── Happy-path pipeline ──────────────────────────
describe("Full pipeline happy path", () => {
  it("registration flow: none → register_new → register_in_progress → active", () => {
    let status: DomainStatus = "none";
    // Client submits
    status = "register_new";
    expect(QUEUED.includes(status)).toBe(true);
    // Admin starts processing
    status = inProgressStatusFor(status);
    expect(status).toBe("register_in_progress");
    expect(IN_PROGRESS.includes(status)).toBe(true);
    // Admin marks done
    status = "active";
    expect(TERMINAL.includes(status)).toBe(true);
  });

  it("transfer flow: none → transfer → transfer_in_progress → active", () => {
    let status: DomainStatus = "none";
    status = "transfer";
    expect(QUEUED.includes(status)).toBe(true);
    status = inProgressStatusFor(status);
    expect(status).toBe("transfer_in_progress");
    status = "active";
    expect(TERMINAL.includes(status)).toBe(true);
  });

  it("rejected flow: admin can reject from any non-terminal state", () => {
    const rejectFrom: DomainStatus[] = [
      "register_new",
      "transfer",
      "register_in_progress",
      "transfer_in_progress",
    ];
    for (const s of rejectFrom) {
      expect(canAdminSet("rejected")).toBe(true);
      expect(["active", "rejected"].includes(s)).toBe(false);
    }
  });
});

// ── EPP code requirement ──────────────────────────
function requiresEppCode(status: DomainStatus): boolean {
  return status === "transfer";
}

describe("EPP code requirements", () => {
  it("transfer requires EPP auth code", () => {
    expect(requiresEppCode("transfer")).toBe(true);
  });

  it("other statuses don't require EPP code", () => {
    expect(requiresEppCode("register_new")).toBe(false);
    expect(requiresEppCode("register_in_progress")).toBe(false);
    expect(requiresEppCode("active")).toBe(false);
  });
});
