import { describe, it, expect } from "vitest";

// Test subdomain validation logic (matching src/lib/deployment/subdomain.ts)
describe("Subdomain Validation", () => {
  function validateSubdomainFormat(subdomain: string): string | null {
    if (!subdomain) return "Subdomain is required";
    if (subdomain.length < 3) return "Subdomain must be at least 3 characters";
    if (subdomain.length > 63) return "Subdomain must be 63 characters or less";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain))
      return "Subdomain must contain only lowercase letters, numbers, and hyphens";
    if (subdomain.startsWith("-") || subdomain.endsWith("-"))
      return "Subdomain cannot start or end with a hyphen";
    return null;
  }

  it("accepts valid subdomains", () => {
    expect(validateSubdomainFormat("pluck")).toBeNull();
    expect(validateSubdomainFormat("balkar-sro")).toBeNull();
    expect(validateSubdomainFormat("my-company123")).toBeNull();
    expect(validateSubdomainFormat("abc")).toBeNull();
  });

  it("rejects too short subdomains", () => {
    expect(validateSubdomainFormat("ab")).toBe("Subdomain must be at least 3 characters");
    expect(validateSubdomainFormat("a")).toBe("Subdomain must be at least 3 characters");
    expect(validateSubdomainFormat("")).toBe("Subdomain is required");
  });

  it("rejects subdomains with uppercase", () => {
    expect(validateSubdomainFormat("Pluck")).not.toBeNull();
    expect(validateSubdomainFormat("BALKAR")).not.toBeNull();
  });

  it("rejects subdomains with spaces or special chars", () => {
    expect(validateSubdomainFormat("my company")).not.toBeNull();
    expect(validateSubdomainFormat("my_company")).not.toBeNull();
    expect(validateSubdomainFormat("my.company")).not.toBeNull();
  });

  it("rejects subdomains starting or ending with hyphen", () => {
    expect(validateSubdomainFormat("-pluck")).not.toBeNull();
    expect(validateSubdomainFormat("pluck-")).not.toBeNull();
  });
});
