/**
 * Final-pass scrubber that runs over every AI response before the
 * overrides hit the composer. Two jobs:
 *
 *   1. Em-dash removal. The copywriting guide explicitly forbids
 *      em-dashes ("—") and en-dashes ("–"). OpenAI models in particular
 *      love them , the system prompt tells them not to, but slips
 *      happen. We replace with a comma + space, which is the closest
 *      natural substitute in 95% of cases. This guarantees no
 *      em-dash ever reaches a client site, regardless of which provider
 *      we're using.
 *
 *   2. Symbol cleanup. Strip bullet glyphs ("•") that some models drop
 *      into list-style outputs and trim trailing whitespace, which is
 *      visually invisible but breaks tight composer layouts.
 *
 * Provider-agnostic , runs on every successful generation in the
 * /api/composer/ai-generate route, so adding a new vendor doesn't
 * require new scrubbing logic.
 *
 * Returns a flag describing what was scrubbed. Useful for logging /
 * future quality dashboards: "OpenAI emitted em-dashes 3% of the time
 * last week" tells us whether to retune the prompt or escalate to
 * gpt-4o.
 */

export interface ScrubResult {
  /** Number of em/en-dashes replaced. */
  emDashHits: number;
  /** Number of leading bullet glyphs trimmed. */
  bulletHits: number;
}

/**
 * Recursively walk the AI's parsed JSON and scrub every string leaf
 * in place. Repeater items (arrays of objects) are handled by the
 * recursion , no special-case for them.
 *
 * Returns counts so the caller can log a flag on the ai_generations
 * row when something was caught. Counts are aggregated across the
 * whole response, not per-field , granular tracking isn't worth the
 * payload bloat.
 */
export function scrubAiResponse(value: unknown): {
  cleaned: unknown;
  result: ScrubResult;
} {
  const result: ScrubResult = { emDashHits: 0, bulletHits: 0 };
  const cleaned = walk(value, result);
  return { cleaned, result };
}

function walk(value: unknown, result: ScrubResult): unknown {
  if (typeof value === "string") {
    return scrubString(value, result);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, result));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walk(v, result);
    }
    return out;
  }
  // numbers, booleans, null, undefined , passthrough
  return value;
}

/**
 * The actual replacement rules. Order matters: dashes first (they
 * leave a comma behind), then bullets (which we strip outright), then
 * whitespace tidy-up.
 *
 * Em-dash: "—" (U+2014). Replace with ", " , English marketing copy
 *   reads fine with a comma for parenthetical asides in 95% of
 *   contexts. The 5% where it doesn't (compound adjectives, dialogue)
 *   the editor catches manually.
 * En-dash: "–" (U+2013). Same treatment as em-dash. English does
 *   sometimes use en-dashes for ranges ("2020–2024") but the model
 *   rarely emits them in that context , marketing copy doesn't have
 *   ranges.
 * Hyphen-minus ("-", U+002D) is preserved , it's a real character
 *   used in compound words like "e-shop", "online-order".
 */
function scrubString(input: string, result: ScrubResult): string {
  let out = input;

  // 1. Dash replacement. Use a single regex with /g so we count all
  //    occurrences, not just the first. The replacement is ", " not
  //    "," , the model usually wraps em-dashes in spaces so we'd end
  //    up with double-spaces if we don't normalize after.
  const dashMatches = out.match(/[—–]/g);
  if (dashMatches) {
    result.emDashHits += dashMatches.length;
    // Replace " — ", " –  ", "—", etc. with ", " uniformly.
    out = out.replace(/\s*[—–]\s*/g, ", ");
  }

  // 2. Strip bullet glyphs at the start of a line , some models
  //    insert these for "list-style" copy even when the field is a
  //    plain string. The rendered template has its own list markup,
  //    so a bare bullet in the data is always wrong.
  const bulletMatches = out.match(/(^|\n)\s*[•●◦]\s*/g);
  if (bulletMatches) {
    result.bulletHits += bulletMatches.length;
    out = out.replace(/(^|\n)\s*[•●◦]\s*/g, "$1");
  }

  // 3. Tidy up. After the dash replacement we may have ", , " or
  //    trailing commas if the model wrote "X — — Y" (rare but seen in
  //    gpt-4o-mini output). Collapse only horizontal whitespace so
  //    intentional newlines in multi-paragraph fields survive.
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/[ \t]*\n[ \t]*/g, "\n"); // strip pad around newlines
  out = out.trim();

  return out;
}
