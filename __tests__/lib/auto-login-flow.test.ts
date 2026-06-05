import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { parseSLSPEmail } from "@/lib/payments/auto-confirm";

// ─────────────────────────────────────────────────────────────────────────────
// Replicate the production encryption with the fixed padded-key logic.
// ─────────────────────────────────────────────────────────────────────────────
function makeKey(serviceRoleKey?: string): string {
  return (serviceRoleKey?.slice(0, 32) || "default-key-change-me-in-prod!!!")
    .padEnd(32, "0")
    .slice(0, 32);
}

function encrypt(text: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "utf-8"), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(encryptedText: string, key: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 2) throw new Error("Invalid token format");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf-8"), iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-login encryption
// ─────────────────────────────────────────────────────────────────────────────
describe("Auto-login key derivation", () => {
  it("default fallback key is exactly 32 bytes", () => {
    const key = makeKey();
    expect(Buffer.from(key, "utf-8").length).toBe(32);
  });

  it("short env value gets padded to 32 bytes", () => {
    const key = makeKey("short");
    expect(Buffer.from(key, "utf-8").length).toBe(32);
    expect(key).toBe("short000000000000000000000000000");
  });

  it("full JWT-style key slices to 32 bytes", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.signature";
    const key = makeKey(jwt);
    expect(Buffer.from(key, "utf-8").length).toBe(32);
  });

  it("empty string env var falls back to default", () => {
    const key = makeKey("");
    expect(Buffer.from(key, "utf-8").length).toBe(32);
  });
});

describe("Auto-login encrypted token round-trip (fallback key)", () => {
  const KEY = makeKey();

  it("encrypts and decrypts an email|password payload", () => {
    const token = encrypt("client@example.sk|Welcome-abc12345!", KEY);
    expect(token.split(":").length).toBe(2);
    expect(decrypt(token, KEY)).toBe("client@example.sk|Welcome-abc12345!");
  });

  it("survives URL encode/decode (travels in query string)", () => {
    const original = "peter@firma.sk|Welcome-xyz98765!";
    const token = encrypt(original, KEY);
    const roundTripped = decrypt(decodeURIComponent(encodeURIComponent(token)), KEY);
    expect(roundTripped).toBe(original);
  });

  it("produces different ciphertext each call (IV randomness)", () => {
    const t1 = encrypt("same@email.sk|same-password", KEY);
    const t2 = encrypt("same@email.sk|same-password", KEY);
    expect(t1).not.toBe(t2);
    expect(decrypt(t1, KEY)).toBe(decrypt(t2, KEY));
  });

  it("handles Slovak diacritics in passwords", () => {
    const password = "Príliš-žltý-kôň!";
    const token = encrypt(`test@sk.sk|${password}`, KEY);
    const [, decPassword] = decrypt(token, KEY).split("|");
    expect(decPassword).toBe(password);
  });

  it("rejects malformed token (missing colon)", () => {
    expect(() => decrypt("nocolon", KEY)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const token = encrypt("a@b.sk|pwd", KEY);
    const tampered = token.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("rejects token encrypted with a different key", () => {
    const otherKey = makeKey("completely-different-service-key");
    const token = encrypt("a@b.sk|pwd", otherKey);
    expect(() => decrypt(token, KEY)).toThrow();
  });
});

describe("Auto-login encrypted token round-trip (real JWT key)", () => {
  const KEY = makeKey("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93bnZjdnJxamRna3Nkd3l0c2tyIn0.sig");

  it("round-trips normal credentials", () => {
    expect(decrypt(encrypt("x@y.sk|pwd", KEY), KEY)).toBe("x@y.sk|pwd");
  });

  it("handles pipe character inside password (ambiguity check)", () => {
    // split("|") on first occurrence only in production — test that the split
    // logic correctly handles the first-pipe-wins behavior
    const decrypted = decrypt(encrypt("x@y.sk|has|pipe|chars", KEY), KEY);
    const [email, ...rest] = decrypted.split("|");
    expect(email).toBe("x@y.sk");
    // Production uses `const [email, password] = decrypted.split("|")` which
    // drops everything after the second pipe. This is a latent bug worth noting.
    expect(rest.join("|")).toBe("has|pipe|chars");
  });

  it("long random password (50 chars)", () => {
    const password = crypto.randomBytes(25).toString("hex");
    const token = encrypt(`a@b.sk|${password}`, KEY);
    expect(decrypt(token, KEY).split("|")[1]).toBe(password);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildNameLine fallbacks (mirror of public/proposal-widget.js logic)
// ─────────────────────────────────────────────────────────────────────────────
function buildNameLine(contactPerson: string | null, companyName: string, town: string | null): string {
  const companySuffixes = ["s.r.o", "s. r. o", "a.s.", "a. s.", "z.z.p.o", "k.s.", "v.o.s."];
  const cp = (contactPerson || "").trim();
  const cn = (companyName || "").trim();
  const tw = (town || "").trim();

  const nameLower = cn.toLowerCase();
  const isCompany = companySuffixes.some((s) => nameLower.includes(s));

  const parts: string[] = [];
  if (isCompany && cp) {
    parts.push(cp);
    parts.push(cn);
  } else {
    parts.push(cn || cp);
  }
  if (tw) {
    parts.push(tw.charAt(0).toUpperCase() + tw.slice(1).toLowerCase());
  }
  const line = parts.filter(Boolean).join(", ");
  return line || "vašu firmu";
}

describe("buildNameLine fallbacks (widget logic)", () => {
  it("company with contact + town", () => {
    expect(buildNameLine("Peter Novák", "Firma s.r.o.", "BRATISLAVA")).toBe(
      "Peter Novák, Firma s.r.o., Bratislava",
    );
  });

  it("self-employed uses company name only", () => {
    expect(buildNameLine("Peter Novák", "Peter Auto", "košice")).toBe("Peter Auto, Košice");
  });

  it("s. r. o. variant with space detected as company", () => {
    expect(buildNameLine("Peter", "Firma s. r. o.", "Nitra")).toBe("Peter, Firma s. r. o., Nitra");
  });

  it("a.s. variant detected as company", () => {
    expect(buildNameLine("Jana", "VUB a.s.", "Bratislava")).toBe("Jana, VUB a.s., Bratislava");
  });

  it("only contact person, no company", () => {
    expect(buildNameLine("Peter Novák", "", "Žilina")).toBe("Peter Novák, Žilina");
  });

  it("only company name", () => {
    expect(buildNameLine(null, "Firma s.r.o.", null)).toBe("Firma s.r.o.");
  });

  it("empty everything → fallback string", () => {
    expect(buildNameLine(null, "", null)).toBe("vašu firmu");
  });

  it("only town → town as fallback", () => {
    expect(buildNameLine(null, "", "Prešov")).toBe("Prešov");
  });

  it("null contact for company proposal", () => {
    expect(buildNameLine(null, "Firma s.r.o.", "Nitra")).toBe("Firma s.r.o., Nitra");
  });

  it("whitespace-only company name", () => {
    expect(buildNameLine("Peter", "   ", "Nitra")).toBe("Peter, Nitra");
  });

  it("uppercase town is title-cased", () => {
    expect(buildNameLine(null, "Firma s.r.o.", "BANSKÁ BYSTRICA")).toBe(
      "Firma s.r.o., Banská bystrica",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SLSP bank email parser
// ─────────────────────────────────────────────────────────────────────────────
describe("parseSLSPEmail — real bank email format", () => {
  it("parses a typical SLSP notification", () => {
    const html = `
      <html><body>
        <p>Dobrý deň,</p>
        <p>na váš účet bola pripísaná platba.</p>
        <table>
          <tr><td>Suma:</td><td><b>199,00 EUR</b></td></tr>
          <tr><td>Referencia:</td><td>/VS2604003/SS/KS</td></tr>
          <tr><td>Protiúčet:</td><td>SK1234567890123456789012 Peter Novak</td></tr>
        </table>
      </body></html>
    `;
    const result = parseSLSPEmail(html);
    expect(result).not.toBeNull();
    expect(result?.variableSymbol).toBe("2604003");
    expect(result?.amount).toBe(199);
  });

  it("parses comma-decimal amounts", () => {
    const result = parseSLSPEmail("Suma: 49,50 EUR Referencia: /VS1234567/SS/");
    expect(result?.amount).toBe(49.5);
  });

  it("parses dot-decimal amounts", () => {
    const result = parseSLSPEmail("Amount: 299.00 EUR Ref: /VS9876543/SS/");
    expect(result?.amount).toBe(299);
  });

  it("returns null when no variable symbol", () => {
    expect(parseSLSPEmail("Random email with 100,00 EUR but no VS reference")).toBeNull();
  });

  it("returns null when no amount", () => {
    expect(parseSLSPEmail("Reference: /VS12345/SS/ but no amount")).toBeNull();
  });

  it("ignores &nbsp; entities", () => {
    const result = parseSLSPEmail("Suma:&nbsp;199,00&nbsp;EUR /VS999/SS/");
    expect(result?.variableSymbol).toBe("999");
    expect(result?.amount).toBe(199);
  });

  it("strips HTML tags before parsing", () => {
    const html = "<div><span>49,00</span> <b>EUR</b></div><p>/VS42/SS/KS</p>";
    const result = parseSLSPEmail(html);
    expect(result?.amount).toBe(49);
    expect(result?.variableSymbol).toBe("42");
  });

  it("returns rawText preview (first 500 chars)", () => {
    const result = parseSLSPEmail("199,00 EUR /VS1/SS/");
    expect(result?.rawText).toBeDefined();
    expect(result?.rawText.length).toBeLessThanOrEqual(500);
  });

  it("handles multiline realistic SLSP email", () => {
    const html = `
      <html>
        <head><title>Slovenská sporiteľňa</title></head>
        <body>
          Vážený klient,<br/>
          na Váš účet bola pripísaná platba.<br/>
          <table>
            <tr><td>Dátum:</td><td>11.04.2026</td></tr>
            <tr><td>Suma:</td><td>149,00&nbsp;EUR</td></tr>
            <tr><td>Referencia:</td><td>/VS4110001/SS0/KS0308</td></tr>
            <tr><td>Protiúčet:</td><td>SK0309000000005221380177 Peter Novak s.r.o.</td></tr>
            <tr><td>Správa:</td><td>Web balkar.2dni.sk</td></tr>
          </table>
        </body>
      </html>
    `;
    const result = parseSLSPEmail(html);
    expect(result?.variableSymbol).toBe("4110001");
    expect(result?.amount).toBe(149);
  });
});
