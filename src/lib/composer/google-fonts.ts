/**
 * Google Fonts catalog fetcher. The Developer API returns the full
 * 1600+ font list with category + weights + popularity info. We hit it
 * once per server process and cache the result — the catalog changes
 * maybe once a month, so a long TTL is fine.
 *
 * Without GOOGLE_FONTS_API_KEY set, falls back to a bundled list of
 * popular fonts so the picker still works during local dev / before the
 * key is configured. The fallback is intentionally small — it's a
 * "things mostly work" safety net, not the real product.
 */

export interface GoogleFont {
  family: string;
  /** "sans-serif" | "serif" | "display" | "handwriting" | "monospace" */
  category: string;
  /** Available font weights as strings, e.g. ["regular","500","700"]. */
  variants: string[];
  /** Available subsets, e.g. ["latin","latin-ext","cyrillic"]. */
  subsets: string[];
}

/** Curated fallback used when GOOGLE_FONTS_API_KEY isn't set. Covers
 *  the ~30 most popular Google Fonts so the picker is usable out of
 *  the box. Sorted roughly by Google Fonts popularity charts. */
const FALLBACK_FONTS: GoogleFont[] = [
  { family: "Inter", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Roboto", category: "sans-serif", variants: ["400","500","700"], subsets: ["latin","latin-ext"] },
  { family: "Open Sans", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Montserrat", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Poppins", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Lato", category: "sans-serif", variants: ["400","700"], subsets: ["latin","latin-ext"] },
  { family: "Nunito", category: "sans-serif", variants: ["400","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Raleway", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Oswald", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Source Sans 3", category: "sans-serif", variants: ["400","600","700"], subsets: ["latin","latin-ext"] },
  { family: "DM Sans", category: "sans-serif", variants: ["400","500","700"], subsets: ["latin","latin-ext"] },
  { family: "Space Grotesk", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Work Sans", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Outfit", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Plus Jakarta Sans", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Manrope", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Be Vietnam Pro", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Mulish", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Quicksand", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Nunito Sans", category: "sans-serif", variants: ["400","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Karla", category: "sans-serif", variants: ["400","500","700"], subsets: ["latin","latin-ext"] },
  { family: "Rubik", category: "sans-serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Roboto Mono", category: "monospace", variants: ["400","500","700"], subsets: ["latin","latin-ext"] },
  { family: "JetBrains Mono", category: "monospace", variants: ["400","500","700"], subsets: ["latin","latin-ext"] },
  { family: "Fira Code", category: "monospace", variants: ["400","500","700"], subsets: ["latin","latin-ext"] },
  { family: "Playfair Display", category: "serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Lora", category: "serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Merriweather", category: "serif", variants: ["400","700"], subsets: ["latin","latin-ext"] },
  { family: "EB Garamond", category: "serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Cormorant Garamond", category: "serif", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "PT Serif", category: "serif", variants: ["400","700"], subsets: ["latin","latin-ext"] },
  { family: "Crimson Text", category: "serif", variants: ["400","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Bebas Neue", category: "display", variants: ["400"], subsets: ["latin","latin-ext"] },
  { family: "Anton", category: "display", variants: ["400"], subsets: ["latin","latin-ext"] },
  { family: "Archivo Black", category: "display", variants: ["400"], subsets: ["latin","latin-ext"] },
  { family: "Caveat", category: "handwriting", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
  { family: "Dancing Script", category: "handwriting", variants: ["400","500","600","700"], subsets: ["latin","latin-ext"] },
];

let cache: { at: number; fonts: GoogleFont[] } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Fetch the Google Fonts catalog. Sorted by popularity (the API's
 * default sort=alpha is replaced with sort=popularity so the most-used
 * fonts surface first in the picker).
 *
 * Cached for 24h per process. Returns the fallback list if either:
 *   - GOOGLE_FONTS_API_KEY isn't set
 *   - The API call fails (network / quota / wrong key)
 *
 * Filters to only fonts that include the `latin-ext` subset so Slovak
 * diacritics render correctly (á, č, ď, é, etc.) — without latin-ext
 * the page falls back to default browser glyphs for those characters,
 * which usually looks visually broken inside an otherwise-uniform font.
 */
export async function getGoogleFonts(): Promise<GoogleFont[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.fonts;

  const key = process.env.GOOGLE_FONTS_API_KEY;
  if (!key) {
    return FALLBACK_FONTS;
  }

  try {
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(
        `[google-fonts] API returned ${res.status}; using fallback list.`,
      );
      return FALLBACK_FONTS;
    }
    const data = (await res.json()) as { items?: GoogleFont[] };
    if (!data.items || !Array.isArray(data.items)) return FALLBACK_FONTS;

    const filtered = data.items.filter((f) =>
      Array.isArray(f.subsets) && f.subsets.includes("latin-ext"),
    );
    cache = { at: Date.now(), fonts: filtered };
    return filtered;
  } catch (err) {
    console.warn("[google-fonts] fetch failed:", err);
    return FALLBACK_FONTS;
  }
}
