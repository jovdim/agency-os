import { describe, it, expect } from "vitest";
import {
  nextStep,
  resolveAttempts,
  statusLabel,
  isInProgress,
  TOTAL_TIMEOUT_MS,
  type DomainSetupRow,
  type DomainSetupStatus,
} from "@/lib/deployment/custom-domain";

/**
 * Convenience helper — most tests only care about overriding 1-2
 * fields, so default everything else to a sensible "not started"
 * shape.
 */
function makeRow(overrides: Partial<DomainSetupRow> = {}): DomainSetupRow {
  return {
    domain_setup_status: null,
    domain_setup_started_at: null,
    domain_setup_attempts: 0,
    domain_zone_id: null,
    domain_nameservers: null,
    requested_domain: "clientname.sk",
    domain: null,
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-05-10T12:00:00Z");

describe("nextStep", () => {
  it("returns 'init' when status is null (legacy row)", () => {
    expect(nextStep(makeRow({ domain_setup_status: null }))).toBe("init");
  });

  it("returns 'init' when status is not_started", () => {
    expect(nextStep(makeRow({ domain_setup_status: "not_started" }))).toBe(
      "init",
    );
  });

  it("returns 'wire_dns' when status is creating_zone", () => {
    expect(
      nextStep(
        makeRow({
          domain_setup_status: "creating_zone",
          domain_setup_started_at: FIXED_NOW.toISOString(),
        }),
        FIXED_NOW,
      ),
    ).toBe("wire_dns");
  });

  it("returns 'wait_for_zone' when status is waiting_dns", () => {
    expect(
      nextStep(
        makeRow({
          domain_setup_status: "waiting_dns",
          domain_setup_started_at: FIXED_NOW.toISOString(),
        }),
        FIXED_NOW,
      ),
    ).toBe("wait_for_zone");
  });

  it("returns 'register_pages' when status is registering_pages", () => {
    expect(
      nextStep(
        makeRow({
          domain_setup_status: "registering_pages",
          domain_setup_started_at: FIXED_NOW.toISOString(),
        }),
        FIXED_NOW,
      ),
    ).toBe("register_pages");
  });

  it("returns 'wait_for_ssl' when status is provisioning_ssl", () => {
    expect(
      nextStep(
        makeRow({
          domain_setup_status: "provisioning_ssl",
          domain_setup_started_at: FIXED_NOW.toISOString(),
        }),
        FIXED_NOW,
      ),
    ).toBe("wait_for_ssl");
  });

  it("returns 'done' when status is active (terminal)", () => {
    expect(
      nextStep(
        makeRow({
          domain_setup_status: "active",
          domain_setup_started_at: FIXED_NOW.toISOString(),
        }),
        FIXED_NOW,
      ),
    ).toBe("done");
  });

  it("returns 'done' when status is failed (terminal, no further work)", () => {
    expect(
      nextStep(
        makeRow({
          domain_setup_status: "failed",
          domain_setup_started_at: FIXED_NOW.toISOString(),
        }),
        FIXED_NOW,
      ),
    ).toBe("done");
  });

  describe("timeout handling", () => {
    it("returns 'abort' when total elapsed > 60 min and not yet terminal", () => {
      const startedAt = new Date(
        FIXED_NOW.getTime() - TOTAL_TIMEOUT_MS - 1000,
      ).toISOString();
      expect(
        nextStep(
          makeRow({
            domain_setup_status: "waiting_dns",
            domain_setup_started_at: startedAt,
          }),
          FIXED_NOW,
        ),
      ).toBe("abort");
    });

    it("does NOT abort terminal-state rows even past the timeout", () => {
      // If we already reached `active` an hour ago, leave it alone.
      const startedAt = new Date(
        FIXED_NOW.getTime() - TOTAL_TIMEOUT_MS * 2,
      ).toISOString();
      expect(
        nextStep(
          makeRow({
            domain_setup_status: "active",
            domain_setup_started_at: startedAt,
          }),
          FIXED_NOW,
        ),
      ).toBe("done");
    });

    it("does NOT abort when within the timeout window", () => {
      // 25 min in, still under the 30-min cap.
      const startedAt = new Date(
        FIXED_NOW.getTime() - 25 * 60 * 1000,
      ).toISOString();
      expect(
        nextStep(
          makeRow({
            domain_setup_status: "provisioning_ssl",
            domain_setup_started_at: startedAt,
          }),
          FIXED_NOW,
        ),
      ).toBe("wait_for_ssl");
    });

    it("does not check timeout when started_at is null (init)", () => {
      // not_started rows have no started_at yet — should still return
      // "init" so the runner can stamp started_at on first call.
      expect(
        nextStep(
          makeRow({
            domain_setup_status: "not_started",
            domain_setup_started_at: null,
          }),
          FIXED_NOW,
        ),
      ).toBe("init");
    });
  });
});

describe("resolveAttempts", () => {
  it("respects an explicit numeric attempts value in the patch", () => {
    const patch = resolveAttempts({
      patch: { domain_setup_status: "creating_zone", domain_setup_attempts: 5 },
      currentStatus: "not_started",
      currentAttempts: 99,
    });
    expect(patch.domain_setup_attempts).toBe(5);
  });

  it("resets attempts to 0 when status advances", () => {
    const patch = resolveAttempts({
      patch: { domain_setup_status: "registering_pages" },
      currentStatus: "waiting_dns",
      currentAttempts: 8,
    });
    expect(patch.domain_setup_attempts).toBe(0);
  });

  it("bumps attempts by 1 when status doesn't change (still polling)", () => {
    const patch = resolveAttempts({
      patch: {}, // empty patch — same state, still waiting
      currentStatus: "waiting_dns",
      currentAttempts: 3,
    });
    expect(patch.domain_setup_attempts).toBe(4);
  });

  it("bumps from 0 to 1 on the first failed-to-advance tick", () => {
    const patch = resolveAttempts({
      patch: {},
      currentStatus: "waiting_dns",
      currentAttempts: 0,
    });
    expect(patch.domain_setup_attempts).toBe(1);
  });

  it("preserves other patch fields untouched", () => {
    const patch = resolveAttempts({
      patch: { domain_setup_error: "something" },
      currentStatus: "waiting_dns",
      currentAttempts: 2,
    });
    expect(patch.domain_setup_error).toBe("something");
    expect(patch.domain_setup_attempts).toBe(3); // bumped, since status didn't change
  });
});

describe("statusLabel", () => {
  it("returns a human-readable string for every status", () => {
    const all: (DomainSetupStatus | null)[] = [
      null,
      "not_started",
      "creating_zone",
      "waiting_dns",
      "registering_pages",
      "provisioning_ssl",
      "active",
      "failed",
    ];
    for (const s of all) {
      const label = statusLabel(s);
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
      // Labels should be human-friendly (no underscores, not raw enum)
      expect(label).not.toMatch(/_/);
    }
  });
});

describe("isInProgress", () => {
  it("is true for the four polling states", () => {
    expect(isInProgress("creating_zone")).toBe(true);
    expect(isInProgress("waiting_dns")).toBe(true);
    expect(isInProgress("registering_pages")).toBe(true);
    expect(isInProgress("provisioning_ssl")).toBe(true);
  });

  it("is false for terminal states", () => {
    expect(isInProgress("active")).toBe(false);
    expect(isInProgress("failed")).toBe(false);
  });

  it("is false for null / not_started (idle, no polling needed)", () => {
    expect(isInProgress(null)).toBe(false);
    expect(isInProgress("not_started")).toBe(false);
  });
});
