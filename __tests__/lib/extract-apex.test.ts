import { describe, it, expect } from "vitest";
import { extractApex, isApex } from "@/lib/deployment/extract-apex";

describe("extractApex", () => {
  describe("simple two-label TLDs (the .sk happy path)", () => {
    it("returns the apex unchanged when input IS the apex", () => {
      expect(extractApex("clientname.sk")).toBe("clientname.sk");
      expect(extractApex("example.com")).toBe("example.com");
      expect(extractApex("foo.de")).toBe("foo.de");
    });

    it("strips a single subdomain", () => {
      expect(extractApex("www.clientname.sk")).toBe("clientname.sk");
      expect(extractApex("shop.clientname.sk")).toBe("clientname.sk");
      expect(extractApex("blog.example.com")).toBe("example.com");
    });

    it("strips multiple subdomain levels", () => {
      expect(extractApex("a.b.c.clientname.sk")).toBe("clientname.sk");
      expect(extractApex("deep.nested.sub.example.com")).toBe("example.com");
    });
  });

  describe("multi-level public suffixes", () => {
    it("treats .co.uk as a single suffix", () => {
      expect(extractApex("example.co.uk")).toBe("example.co.uk");
      expect(extractApex("www.example.co.uk")).toBe("example.co.uk");
      expect(extractApex("a.b.example.co.uk")).toBe("example.co.uk");
    });

    it("treats .com.au as a single suffix", () => {
      expect(extractApex("shop.example.com.au")).toBe("example.com.au");
    });

    it("treats .gov.sk as a single suffix (Slovak gov)", () => {
      expect(extractApex("www.ministerstvo.gov.sk")).toBe("ministerstvo.gov.sk");
    });

    it("does NOT mistake regular .sk for a multi-suffix", () => {
      // `clientname.sk` is the apex — extracting again returns itself.
      expect(extractApex("clientname.sk")).toBe("clientname.sk");
      // And `subdomain.clientname.sk` collapses to the two-label apex.
      expect(extractApex("subdomain.clientname.sk")).toBe("clientname.sk");
    });
  });

  describe("normalization", () => {
    it("lowercases the input", () => {
      expect(extractApex("WWW.ClientName.SK")).toBe("clientname.sk");
    });

    it("trims surrounding whitespace", () => {
      expect(extractApex("  www.clientname.sk  ")).toBe("clientname.sk");
    });

    it("strips leading/trailing dots", () => {
      expect(extractApex(".clientname.sk.")).toBe("clientname.sk");
    });
  });

  describe("invalid input", () => {
    it("throws on empty string", () => {
      expect(() => extractApex("")).toThrow(/empty/i);
      expect(() => extractApex("   ")).toThrow(/empty/i);
    });

    it("throws on single-label input (no TLD)", () => {
      expect(() => extractApex("localhost")).toThrow(/no TLD/i);
      expect(() => extractApex("clientname")).toThrow(/no TLD/i);
    });
  });
});

describe("isApex", () => {
  it("is true for bare apex domains", () => {
    expect(isApex("clientname.sk")).toBe(true);
    expect(isApex("example.com")).toBe(true);
    expect(isApex("example.co.uk")).toBe(true);
  });

  it("is false when there's any subdomain", () => {
    expect(isApex("www.clientname.sk")).toBe(false);
    expect(isApex("shop.clientname.sk")).toBe(false);
    expect(isApex("a.b.example.co.uk")).toBe(false);
  });

  it("normalizes input the same way extractApex does", () => {
    expect(isApex("ClientName.SK")).toBe(true);
    expect(isApex("WWW.ClientName.SK")).toBe(false);
  });
});
