import crypto from "node:crypto";

/**
 * Standalone auth for per-site CMS admins (theirdomain.com/admin), fully
 * separate from the CRM staff Supabase auth. Uses only Node's built-in crypto —
 * no external dependencies.
 *
 *   - Passwords: scrypt with a random per-password salt.
 *   - Session: a compact HMAC-SHA256-signed token stored in an HttpOnly,
 *     host-scoped cookie. The token carries the site_admin id + site_id + expiry.
 *     Every /admin route asserts `session.site_id === host-resolved site`, and
 *     the cookie is host-scoped (no Domain attr), so a session minted on site A
 *     can never be presented on site B.
 *
 * Runs only in Node route handlers / server components (never the Edge runtime).
 */

const SCRYPT_KEYLEN = 32;
export const SITE_SESSION_COOKIE = "sk_site_session";
export const SITE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ── Passwords ──────────────────────────────────────────────────────────────

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    // Fail closed on malformed/placeholder hashes: a zero/short hash or empty
    // salt must NEVER authenticate (a stored `scrypt$<salt>$=` would otherwise
    // compare two empty buffers and pass). Always derive with the fixed length.
    if (salt.length === 0 || expected.length !== SCRYPT_KEYLEN) return false;
    const actual = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** A real scrypt hash used to equalize login timing for unknown/inactive
 *  accounts (run verifyPassword against this so every failure path does the
 *  same scrypt work — no user-enumeration oracle). Computed once, lazily. */
let dummyHash: string | null = null;
export function dummyPasswordHash(): string {
  if (!dummyHash) dummyHash = hashPassword("timing-equalizer-not-a-real-secret");
  return dummyHash;
}

// ── Session token ──────────────────────────────────────────────────────────

interface SessionPayload {
  sid: string; // site_admin id
  site_id: string;
  exp: number; // unix seconds
}

function sessionSecret(): string {
  // Prefer a dedicated secret; fall back to the service-role key (always present)
  // so dev works without extra env config. Set PLATFORM_SESSION_SECRET in prod.
  const s =
    process.env.PLATFORM_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  // Fail closed: an empty/weak HMAC key would make every session token forgeable.
  if (s.length < 32) {
    throw new Error(
      "Session signing secret missing/too short — set PLATFORM_SESSION_SECRET (>=32 random chars).",
    );
  }
  return s;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
}

export function createSessionToken(siteAdminId: string, siteId: string): string {
  const payload: SessionPayload = {
    sid: siteAdminId,
    site_id: siteId,
    exp: Math.floor(Date.now() / 1000) + SITE_SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws then).
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.sid || !payload?.site_id || typeof payload.exp !== "number") {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** Escape LIKE/ILIKE wildcards (emails legitimately contain `_`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
