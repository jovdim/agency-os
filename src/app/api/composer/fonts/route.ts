import { NextResponse } from "next/server";
import { getGoogleFonts } from "@/lib/composer/google-fonts";

// Server-side: hit the Google Fonts catalog once and cache for the
// process lifetime. The route response sets a 1h browser cache so the
// composer doesn't re-fetch on every theme-panel open.
export const dynamic = "force-dynamic";

/**
 * GET /api/composer/fonts
 *
 * Returns the full Google Fonts catalog (1600+ fonts) sorted by
 * popularity, filtered to fonts with latin-ext support (needed for
 * Slovak diacritics). Used by the Theme panel's font picker.
 *
 * Response shape: { fonts: GoogleFont[] }
 *
 * Auth: any logged-in user. The catalog isn't sensitive — anyone with
 * a browser can already query Google Fonts. We gate it lightly only to
 * keep our own quota use proportional to actual composer activity.
 */
export async function GET() {
  const fonts = await getGoogleFonts();
  return NextResponse.json(
    { fonts },
    {
      headers: {
        // Browser cache 1h, stale-while-revalidate another 23h. Catalog
        // changes maybe once a month — long caching is safe.
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=82800",
      },
    },
  );
}
