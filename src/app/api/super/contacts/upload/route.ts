import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// CSV column mapping
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function findColumnIndex(headers: string[], ...candidates: string[]): number {
  // Try exact match first
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (idx !== -1) return idx;
  }
  // Try stripped diacritics match
  for (const c of candidates) {
    const stripped = stripDiacritics(c);
    const idx = headers.findIndex(h => stripDiacritics(h).includes(stripped));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Extract first valid phone from multiple columns
function extractPhones(row: string[], indices: number[]): string[] {
  const phones: string[] = [];
  for (const idx of indices) {
    if (idx === -1 || !row[idx]) continue;
    const val = row[idx].trim();
    if (!val) continue;
    // Split comma-separated numbers
    const parts = val.split(",").map(p => p.trim()).filter(p => p.length >= 5);
    phones.push(...parts);
  }
  // Deduplicate
  return [...new Set(phones)];
}

// Extract first valid email from multiple columns
function extractEmail(row: string[], indices: number[]): string | null {
  for (const idx of indices) {
    if (idx === -1 || !row[idx]) continue;
    const val = row[idx].trim().toLowerCase();
    if (val && val.includes("@")) return val;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData;
  try {
    formData = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: "Failed to read file. Make sure it's a valid CSV file." }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV file is empty or has no data rows" }, { status: 400 });
  }

  // Parse headers (strip BOM from first header if present)
  const headers = parseCSVLine(lines[0]).map((h, i) =>
    i === 0 ? h.replace(/^﻿/, "") : h,
  );

  // Detect format:
  //   LEADS CSV (bazos-style): Phone, Source, Seller, Total Listings, Location, Website, Services, Description, URL
  //   Slovak business CSV: IČO, Názov, Kategória, Website, Telefón 1, ...
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const isLeadsFormat =
    lowerHeaders.includes("seller") &&
    lowerHeaders.includes("phone") &&
    (lowerHeaders.includes("services") || lowerHeaders.includes("description"));

  // Find column indices
  // Also try by column position if headers are known CSV format (IČO, Názov, Kategória, Website, Telefón 1, ...)
  const isKnownFormat = headers.length >= 14;

  const nameIdx = findColumnIndex(headers, "Názov", "Nazov", "Name", "Company") !== -1
    ? findColumnIndex(headers, "Názov", "Nazov", "Name", "Company")
    : isKnownFormat ? 1 : -1;
  const categoryIdx = findColumnIndex(headers, "Kategória", "Kategoria", "Category") !== -1
    ? findColumnIndex(headers, "Kategória", "Kategoria", "Category")
    : isKnownFormat ? 2 : -1;
  const websiteIdx = findColumnIndex(headers, "Website", "Web") !== -1
    ? findColumnIndex(headers, "Website", "Web")
    : isKnownFormat ? 3 : -1;
  const phone1Idx = findColumnIndex(headers, "Telefón 1", "Telefon 1", "Phone 1", "Phone") !== -1
    ? findColumnIndex(headers, "Telefón 1", "Telefon 1", "Phone 1", "Phone")
    : isKnownFormat ? 4 : -1;
  const phone2Idx = findColumnIndex(headers, "Telefón 2", "Telefon 2", "Phone 2") !== -1
    ? findColumnIndex(headers, "Telefón 2", "Telefon 2", "Phone 2")
    : isKnownFormat ? 5 : -1;
  const phone3Idx = findColumnIndex(headers, "Telefón_3", "Telefon_3", "Phone_3", "Phone 3") !== -1
    ? findColumnIndex(headers, "Telefón_3", "Telefon_3", "Phone_3", "Phone 3")
    : isKnownFormat ? 6 : -1;
  const email1Idx = findColumnIndex(headers, "Email1", "Email 1", "Email") !== -1
    ? findColumnIndex(headers, "Email1", "Email 1", "Email")
    : isKnownFormat ? 7 : -1;
  const email2Idx = findColumnIndex(headers, "Email 2", "Email2") !== -1
    ? findColumnIndex(headers, "Email 2", "Email2")
    : isKnownFormat ? 8 : -1;
  const email3Idx = findColumnIndex(headers, "Email 3", "Email3", "Email_3") !== -1
    ? findColumnIndex(headers, "Email 3", "Email3", "Email_3")
    : isKnownFormat ? 9 : -1;
  const cityIdx = findColumnIndex(headers, "Mesto", "City") !== -1
    ? findColumnIndex(headers, "Mesto", "City")
    : isKnownFormat ? 11 : -1;
  const districtIdx = findColumnIndex(headers, "Okres", "District") !== -1
    ? findColumnIndex(headers, "Okres", "District")
    : isKnownFormat ? 13 : -1;

  if (nameIdx === -1 && !isLeadsFormat) {
    return NextResponse.json({
      error: `Could not find company name column. Detected headers: ${headers.slice(0, 5).join(", ")}`,
      headers: headers.slice(0, 16),
    }, { status: 400 });
  }

  console.log("[CSV Upload] Column mapping:", { isLeadsFormat, nameIdx, categoryIdx, websiteIdx, phone1Idx, phone2Idx, phone3Idx, email1Idx, cityIdx, districtIdx });

  const phoneIndices = [phone1Idx, phone2Idx, phone3Idx];
  const emailIndices = [email1Idx, email2Idx, email3Idx];

  const admin = createAdminClient();

  // Parse all rows first
  const rows: Array<{
    company_name: string;
    industry: string | null;
    website_url: string | null;
    phones: string[];
    phone: string | null;
    email: string | null;
    town: string | null;
    district: string | null;
    total_listings: number | null;
    description: string | null;
    services_offered: string | null;
    source_url: string | null;
    cities_count: number | null;
    postal_code: string | null;
    location_raw: string | null;
  }> = [];

  /**
   * Parse the Location column from the leads CSV.
   * Handles two formats:
   *   "9 cities"                    → { citiesCount: 9, town: null, postalCode: null }
   *   "Bratislava851 06"            → { citiesCount: null, town: "Bratislava", postalCode: "851 06" }
   *   "Kysucké Nové Mesto023 33"    → { citiesCount: null, town: "Kysucké Nové Mesto", postalCode: "023 33" }
   */
  function parseLocation(raw: string): {
    citiesCount: number | null;
    town: string | null;
    postalCode: string | null;
  } {
    const trimmed = raw.trim();
    if (!trimmed) return { citiesCount: null, town: null, postalCode: null };

    // Pattern: "X cities" or "X city"
    const citiesMatch = trimmed.match(/^(\d+)\s*cit(y|ies)$/i);
    if (citiesMatch) {
      return { citiesCount: parseInt(citiesMatch[1], 10), town: null, postalCode: null };
    }

    // Pattern: "CityName<digits> <digits>" — Slovak postal codes are 5 digits, usually written as "XXX XX"
    // Sometimes glued to city without space, e.g. "Bratislava851 06"
    const postalMatch = trimmed.match(/^(.+?)(\d{3}\s*\d{2})\s*$/);
    if (postalMatch) {
      const town = postalMatch[1].trim();
      const postalCode = postalMatch[2].replace(/\s+/g, " ").trim();
      return { citiesCount: null, town: town || null, postalCode };
    }

    // Fallback: treat as plain city name
    return { citiesCount: null, town: trimmed, postalCode: null };
  }

  // ── LEADS CSV format (bazos.sk style) ──
  if (isLeadsFormat) {
    const idx = (name: string) =>
      lowerHeaders.findIndex((h) => h === name.toLowerCase());
    const phoneI = idx("phone");
    const sellerI = idx("seller");
    const totalI = idx("total listings");
    const locationI = idx("location");
    const websiteI = idx("website");
    const servicesI = idx("services");
    const descI = idx("description");
    const urlI = idx("url");
    // Intentionally skip "source" — user doesn't want it

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const phone = phoneI !== -1 ? cols[phoneI]?.trim() || null : null;
      const seller = sellerI !== -1 ? cols[sellerI]?.trim() : "";
      if (!seller && !phone) continue; // need at least one
      const company = seller || "(no name)";

      const totalRaw = totalI !== -1 ? cols[totalI]?.trim() : "";
      const totalListings = totalRaw && /^\d+$/.test(totalRaw) ? parseInt(totalRaw, 10) : null;

      const description = descI !== -1 ? cols[descI]?.trim() || null : null;

      const rawLoc = locationI !== -1 ? cols[locationI]?.trim() || "" : "";
      const locParsed = rawLoc ? parseLocation(rawLoc) : { citiesCount: null, town: null, postalCode: null };

      rows.push({
        company_name: company,
        industry: null,
        website_url: websiteI !== -1 ? cols[websiteI]?.trim() || null : null,
        phones: phone ? [phone] : [],
        phone,
        email: null,
        town: locParsed.town,
        district: null,
        total_listings: totalListings,
        description,
        services_offered: servicesI !== -1 ? cols[servicesI]?.trim() || null : null,
        source_url: urlI !== -1 ? cols[urlI]?.trim() || null : null,
        cities_count: locParsed.citiesCount,
        postal_code: locParsed.postalCode,
        location_raw: rawLoc || null,
      });
    }
  } else {
    // ── Slovak business CSV format (original) ──
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      let name = cols[nameIdx]?.trim();
      if (!name) continue; // Skip rows without company name

      // Truncate at first comma — remove address/extra info from company name
      if (name.includes(",")) {
        name = name.split(",")[0].trim();
      }

      const phones = extractPhones(cols, phoneIndices);
      const email = extractEmail(cols, emailIndices);
      const phone = phones[0] || null;

      // Skip if no phone AND no email
      if (!phone && !email) continue;

      rows.push({
        company_name: name,
        industry: categoryIdx !== -1 ? cols[categoryIdx]?.trim() || null : null,
        website_url: websiteIdx !== -1 ? cols[websiteIdx]?.trim() || null : null,
        phones,
        phone,
        email,
        town: cityIdx !== -1 ? cols[cityIdx]?.trim() || null : null,
        district: districtIdx !== -1 ? cols[districtIdx]?.trim() || null : null,
        total_listings: null,
        description: null,
        services_offered: null,
        source_url: null,
        cities_count: null,
        postal_code: null,
        location_raw: null,
      });
    }
  }

  // ── ATOMIC UPLOAD: all-or-nothing ──
  // 1. Dedup check: fetch all existing phones that appear in this CSV
  // 2. Filter out duplicates (they'd cause unique-constraint errors)
  // 3. Insert ALL remaining rows in a single statement
  //    → Postgres auto-rolls back the whole insert if ANY row fails
  // If any error occurs, zero rows are kept. No partial state.
  const totalRows = rows.length;
  const allPhones = rows.map(r => r.phone).filter(Boolean) as string[];

  // Single-round-trip dedup via RPC (migration 00066). Replaces the old
  // chunked-by-100 SELECT loop that ran 500 round-trips per 50k CSV.
  const existingPhones = new Set<string>();
  if (allPhones.length > 0) {
    const { data: existing, error: rpcError } = await admin
      .rpc("contacts_existing_phones", { p_phones: allPhones });
    if (rpcError) {
      console.error("[CSV Upload] Dedup RPC failed:", rpcError.message);
      return NextResponse.json({
        error: `Dedup check failed: ${rpcError.message}`,
      }, { status: 500 });
    }
    for (const row of (existing ?? []) as { phone: string | null }[]) {
      if (row.phone) existingPhones.add(row.phone);
    }
  }

  const newRows = rows.filter(r => !(r.phone && existingPhones.has(r.phone)));
  const duplicates = rows.length - newRows.length;

  if (newRows.length === 0) {
    return NextResponse.json({
      success: true,
      total_parsed: totalRows,
      inserted: 0,
      duplicates,
      skipped: duplicates,
      errors: 0,
      message: `Nothing to import — all ${totalRows} contacts already exist.`,
    });
  }

  const inserts = newRows.map(r => ({
    company_name: r.company_name,
    industry: r.industry,
    website_url: r.website_url,
    phones: r.phones.length > 0 ? r.phones : null,
    phone: r.phone,
    email: r.email,
    town: r.town,
    district: r.district,
    total_listings: r.total_listings,
    description: r.description,
    services_offered: r.services_offered,
    source_url: r.source_url,
    cities_count: r.cities_count,
    postal_code: r.postal_code,
    location_raw: r.location_raw,
    status: "new",
    source: "csv_import",
  }));

  const { error: insertError } = await admin
    .from("contacts")
    .insert(inserts);

  if (insertError) {
    // Single insert failed → Postgres already rolled it back, nothing was saved.
    console.error("[CSV Upload] Atomic insert failed:", insertError.message);
    return NextResponse.json({
      success: false,
      total_parsed: totalRows,
      inserted: 0,
      duplicates,
      errors: newRows.length,
      error: `Upload failed, nothing was imported: ${insertError.message}`,
      message: `Nothing was imported. Error: ${insertError.message}`,
    }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    total_parsed: totalRows,
    inserted: newRows.length,
    duplicates,
    skipped: duplicates,
    errors: 0,
    message: `Imported ${newRows.length} contacts. ${duplicates} duplicates skipped.`,
  });

  } catch (err) {
    console.error("[CSV Upload] Unexpected error:", err);
    return NextResponse.json({
      error: `Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    }, { status: 500 });
  }
}
