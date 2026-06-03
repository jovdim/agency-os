/**
 * Smart-prompt builder for the per-field AI image button.
 *
 * Goal: when the user clicks ✨ next to an image field, the popover
 * opens with a prompt already pre-filled based on:
 *   1. WHAT kind of image this slot needs (hero environment shot vs
 *      service close-up vs team headshot vs workshop scene). Classified
 *      from the field key + the section's category.
 *   2. WHO the business is (industry + town + services). Pulled from
 *      the linked proposal via /api/composer/ai-inputs.
 *
 * The user can still edit the textarea before submitting — this is a
 * starting point, not a lock-in. The realism enforcer ("photorealistic,
 * professional photo, sharp focus, no text, no watermark") is appended
 * SERVER-SIDE in /api/composer/ai-image so users can't accidentally
 * delete it. That's the one rule we enforce for every generation.
 *
 * Why not a heavyweight LLM call to generate the prompt itself: each
 * extra LLM round-trip adds ~3s + neuron cost + a failure mode. For
 * 80% of fields, simple template substitution gets us there. Power
 * users who want hyper-specific shots edit the textarea themselves.
 */

export interface ImagePromptContext {
  /** Business name. Rarely useful in the prompt itself but kept for
   *  future expansions (e.g., generating a logo placeholder). */
  companyName: string;
  /** e.g., "roofing", "auto repair", "cafe". Drives the
   *  noun in the generated prompt — the AI gets a real
   *  industry term, not a generic "business". */
  industry: string;
  /** e.g., "Manchester". Adds geographic flavour ("in a small
   *  town"). Skipped from the prompt if empty. */
  town: string;
  /** Optional service list. Used when the field is a service-specific
   *  image to bias the visual toward that one service. */
  services?: Array<{ title: string; description?: string }>;
}

/**
 * Categories of images we know how to template for. The classifier
 * below maps field-key + section-category to one of these. New
 * archetypes are easy to add — extend this union and the lookup.
 */
type ImageArchetype =
  | "hero_environment" // Wide shot of business in action (homepage hero)
  | "cta_atmosphere" // Atmospheric backdrop for a call-to-action band
  | "service_detail" // Close-up of one specific service being performed
  | "gallery_work" // Varied portfolio shot — finished work, materials, tools
  | "team_portrait" // Professional headshot of a tradesperson
  | "about_workspace" // Workshop, storefront, vehicle fleet, behind-the-scenes
  | "generic"; // Catch-all when we can't classify

/**
 * Classify an image field into an archetype based on its key + the
 * section it lives in. Hierarchy: field key wins (most specific signal)
 * over section category (broader bucket).
 *
 * Examples:
 *   ("hero_image", "hero")           → hero_environment
 *   ("service_1_icon", "services")   → service_detail
 *   ("gallery_2", "gallery")         → gallery_work
 *   ("team_photo_1", "team")         → team_portrait
 *   ("about_image", "about")         → about_workspace
 *   ("contact_image", "contact")     → about_workspace (closest fit)
 *   ("foo_bar", "unknown_section")   → generic
 */
export function classifyImageField(
  fieldKey: string,
  sectionCategory?: string,
): ImageArchetype {
  const k = fieldKey.toLowerCase();
  const c = (sectionCategory ?? "").toLowerCase();

  // Strongest signal: explicit "team" / "person" / "headshot" / "portrait"
  // anywhere in the field key — those almost always want a human face.
  if (/team|person|headshot|portrait|member|founder|owner/.test(k))
    return "team_portrait";

  // Service-specific image fields. Pattern is usually service_N_image
  // or services_items[].image — we match the "service" stem in the
  // field key OR the section category. The category check matters
  // because inside a services repeater, the per-item image field is
  // just keyed "image" with no "service" prefix.
  if (/service/.test(k) || c === "services" || c === "service") return "service_detail";

  // Gallery / portfolio. Either an explicit "gallery" key or a section
  // categorised as gallery/portfolio/work.
  if (/gallery|portfolio|work_item|case_study/.test(k) || /gallery|portfolio/.test(c))
    return "gallery_work";

  // About / workshop / storefront. Either an explicit "about" key or
  // an about/contact section's image (usually a "where to find us" or
  // workshop shot). Also catches "team" category fields that aren't
  // person-shaped (e.g., "team_workshop_image").
  if (
    /about|workshop|workplace|storefront/.test(k) ||
    c === "about" ||
    c === "contact" ||
    c === "team"
  )
    return "about_workspace";

  // Hero — wide environmental hero image, the homepage banner.
  if (/hero|banner|cover/.test(k) || c === "hero") return "hero_environment";

  // CTA — atmospheric backdrop for a call-to-action band. Field keys are
  // typically `cta_bg`, `cta_image`, `cta_background`. The CTA prompt is
  // close to hero_environment (wide, atmospheric, real working scene)
  // but biases toward a "moment of completion / handoff / satisfied work"
  // tone — appropriate for the close-of-page nudge to act.
  if (/^cta_(bg|image|background)|cta$/.test(k) || c === "cta")
    return "cta_atmosphere";

  return "generic";
}

/**
 * Build a prompt for the given archetype + business context. Returns
 * an English prompt because FLUX is heavily English-trained and
 * non-English tokens often degrade output quality. The user-facing
 * prompt textarea still SHOWS this English text — they can edit/translate
 * it before generating.
 *
 * The realism enforcer is intentionally NOT included here — it gets
 * appended server-side. This way users can edit the visible prompt
 * however they like and still get realistic output every time.
 *
 * Sibling-aware: when `siblingFields` is provided, we look for the
 * peer item's title (`title`, `name`, `heading`) and description
 * (`description`, `text`, `body`) and use them as the SUBJECT of the
 * image — so a service repeater's row "gutter replacement / complete
 * replacement of old gutters" generates a gutter-replacement scene
 * instead of a generic plumbing scene. Without this, every item in a
 * 6-row services repeater would get the same prompt and look identical.
 */
export function buildImagePrompt(args: {
  fieldKey: string;
  sectionCategory?: string;
  /** Peer fields' string values — see PlaceholderField.siblingFields. */
  siblingFields?: Record<string, string>;
  context: ImagePromptContext;
}): string {
  const archetype = classifyImageField(args.fieldKey, args.sectionCategory);
  const { industry, town, services } = args.context;
  // Default fallbacks if proposal data is sparse — keeps the prompt
  // useful even for standalone client sites with no proposal attached.
  const ind = industry.trim() || "small business";
  const place = town.trim() ? ` in ${town.trim()}` : "";

  // Resolve a SUBJECT (what specific thing this image should depict)
  // by walking siblingFields for the most informative peer values.
  // Priority: title-shaped keys first (most specific), then
  // description-shaped keys (more context), then back to industry.
  const sib = args.siblingFields ?? {};
  const peerTitle = pickFirstNonEmpty(sib, [
    "title",
    "name",
    "heading",
    "headline",
    "service_title",
    "card_title",
  ]);
  const peerDescription = pickFirstNonEmpty(sib, [
    "description",
    "text",
    "body",
    "subtext",
    "subtitle",
    "service_description",
  ]);

  // Service-detail-specific lookups: when the FIELD itself doesn't
  // give us much context, we still want a per-row prompt. If the
  // section has no peer title and we're inside a services repeater,
  // fall back to the matching index in the services list.
  const indexedService = pickIndexedService(args.fieldKey, services);
  const subject =
    peerTitle ||
    indexedService?.title ||
    services?.[0]?.title?.trim() ||
    "";
  const subjectDetail =
    peerDescription || indexedService?.description || "";

  // All archetypes share the same anti-stock vocabulary: "documentary",
  // "candid", "real worker" (not "model"), "slightly imperfect", "real
  // moment". The lever that pushes FLUX off its polished stock-photo
  // defaults. The realism enforcer (server-side) layers on top: no
  // text, no watermarks, no logos, photorealistic camera language.
  //
  // Sibling-aware paths use `subject` (peer title) + `subjectDetail`
  // (peer description) when available — that's the difference between
  // "Generate something for roofing" and "Generate someone
  // replacing a gutter on a family house". The subject string
  // is dropped into the prompt verbatim; any language works.

  // Build a subject phrase used by service/gallery archetypes — guards
  // against the "no peer data" case where we have to fall back to a
  // generic industry shot.
  const subjectPhrase = subject
    ? subjectDetail
      ? `${subject} (${subjectDetail})`
      : subject
    : "";

  switch (archetype) {
    case "hero_environment":
      // Wide environmental shot — the homepage banner. Documentary
      // style, real worker (not a posed model), real workplace.
      // Hero often has a peer headline ("Roofs and gutters in Manchester") —
      // when present, we use it to bias the scene.
      return subject
        ? `Documentary photo of a real ${ind} business depicting "${subjectPhrase}"${place}, candid working moment, natural daylight, real worn working clothes, slight motion or weather visible, NOT a stock photo, NOT posed, NOT smiling at camera`
        : `Documentary photo of a real ${ind} worker on the job${place}, candid moment, natural daylight, slight motion, dust or weather visible, real working clothes with wear marks, NOT a stock photo, NOT posed, NOT smiling at camera`;

    case "cta_atmosphere":
      // CTA backdrop — wide atmospheric shot meant to sit BEHIND a dark
      // gradient overlay with a call-to-action button on top. The image
      // doesn't need to carry the message (the headline + button do),
      // it just needs to set the mood: "this is the moment to act."
      // Bias toward a "completion / handoff / quiet pride in work" tone
      // rather than action-mid-task (that's the hero's job). Slightly
      // darker / moodier composition reads better through the overlay.
      return subject
        ? `Documentary photo of a real ${ind} business at the moment of finishing or handing off work depicting "${subjectPhrase}"${place}, quiet end-of-job feeling, slightly low light or end-of-day warmth, real worn tools resting, no faces visible or face turned away, composition leaves space for overlay text, NOT a stock photo, NOT a marketing shot, NOT posed`
        : `Documentary photo of a real ${ind} business at a quiet finishing moment${place}, end-of-job feeling, slightly low or warm light, real worn tools resting or being put away, no faces or face turned away, composition leaves space for overlay text, NOT a stock photo, NOT a marketing shot, NOT posed`;

    case "service_detail":
      // Close-up of THIS specific service being performed — the part
      // the previous version got wrong. Now keys off the peer row's
      // title + description so each service-card image is unique.
      return subject
        ? `Close-up documentary photo of hands actively performing "${subjectPhrase}" — real worn tools, real materials specific to this exact task, slight imperfections, natural light, ${ind} trade context${place}, NOT a stock photo, NOT staged, NOT a generic ${ind} shot`
        : `Close-up documentary photo of hands actively performing one service in the ${ind} trade, real worn tools, real materials, slight imperfections, natural light, NOT a stock photo, NOT staged`;

    case "gallery_work":
      // Portfolio — if the gallery item has a peer caption / title,
      // use it as the subject. Otherwise vary by industry.
      return subject
        ? `Documentary photo of finished work depicting "${subjectPhrase}", real worksite context, natural light, slight imperfections of real life, no people in frame, shot from a believable handheld angle, NOT a glossy stock photo, NOT advertising-style, NOT a generic ${ind} shot`
        : `Documentary photo of finished ${ind} work, real worksite context, natural light, slight imperfections of real life, no people in frame, shot from a believable handheld angle, NOT a glossy stock photo, NOT advertising-style`;

    case "team_portrait":
      // Headshot — anti-LinkedIn, anti-stock. If the peer row has a
      // name + role, weave them in (FLUX won't generate the literal
      // name on the face but the role biases clothing/setting).
      return subject
        ? `Documentary portrait of a real ${ind} tradesperson in the role of ${subjectPhrase}, mid-30s to 50s, neutral expression, real worn work clothes appropriate to the role, natural light, slight imperfections, looks like a candid photo not a posed shoot, NOT a stock photo, NOT a smiling business portrait`
        : `Documentary portrait of a real ${ind} tradesperson, mid-30s to 50s, neutral expression, real worn work clothes, natural light, slight imperfections, looks like a candid photo not a posed shoot, NOT a stock photo, NOT a smiling business portrait`;

    case "about_workspace":
      // Workshop — lived-in, real, no people. Peer subtext often
      // says something specific ("Our workshop since 2008") — bias
      // the shot toward it.
      return subject
        ? `Documentary photo of a real ${ind} workshop or premises${place}, depicting "${subjectPhrase}", lived-in, real tools and materials in real positions, natural daylight, no people, slightly cluttered like a real working space, NOT a stock photo, NOT staged`
        : `Documentary photo of a real ${ind} workshop or premises${place}, lived-in, real tools and materials in real positions, natural daylight, no people, slightly cluttered like a real working space, NOT a stock photo, NOT staged`;

    case "generic":
    default:
      return subject
        ? `Documentary photo depicting "${subjectPhrase}" in the context of a real ${ind} business${place}, candid working moment, natural light, NOT a stock photo`
        : `Documentary photo of a real ${ind} business${place}, candid working moment, natural light, NOT a stock photo`;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Sibling-field helpers
   ─────────────────────────────────────────────────────────────────── */

/**
 * Walk a list of candidate keys against a flat string-map and return
 * the first non-empty trimmed value. Used to find the "title-like" or
 * "description-like" peer field in a section/item without coupling to
 * a specific schema shape — different templates name their text fields
 * differently (`title` vs `headline` vs `service_title`) and we want
 * to match all of them.
 */
function pickFirstNonEmpty(
  fields: Record<string, string>,
  candidates: string[],
): string {
  for (const key of candidates) {
    // Exact match first.
    const exact = fields[key];
    if (exact && exact.trim()) return exact.trim();
    // Then partial match — fields named like "card_title" or
    // "section_heading" still win even if the canonical key list
    // doesn't contain that exact spelling.
    for (const fk of Object.keys(fields)) {
      if (fk.toLowerCase().endsWith(`_${key}`) || fk.toLowerCase() === key) {
        const v = fields[fk];
        if (v && v.trim()) return v.trim();
      }
    }
  }
  return "";
}

/**
 * For repeater service items where the inner image field has no peer
 * title (rare but possible), fall back to picking the Nth service from
 * the proposal-level services list. Field keys like `service_2_image`
 * or `service[2].image` give us the index — we reuse the same N to
 * pick from the services array.
 *
 * Returns null if no index can be inferred or the services list is
 * shorter than the index.
 */
function pickIndexedService(
  fieldKey: string,
  services?: Array<{ title: string; description?: string }>,
): { title: string; description?: string } | null {
  if (!services || services.length === 0) return null;
  const m = fieldKey.match(/(?:service|item|card)[_\s-]*?(\d+)/i);
  if (!m) return null;
  // Field keys are typically 1-indexed in templates, services array
  // is 0-indexed.
  const idx = parseInt(m[1], 10) - 1;
  if (idx < 0 || idx >= services.length) return null;
  return services[idx];
}

/**
 * Server-side realism enforcer. Always appended to the user's prompt
 * (whatever they wrote or kept as the auto-fill default) before the
 * call to FLUX. Lives here, not in the API route, so the test script
 * + future section-batch endpoint can use the same suffix.
 *
 * The enforcer pushes against TWO failure modes FLUX falls into by
 * default:
 *
 *   1. "Illustration / cartoon" — handled by "photorealistic" + camera
 *      details ("shot on Fuji X-T4, 35mm lens"). Naming a real-camera
 *      setup nudges training-data weights toward photographic outputs.
 *
 *   2. "Stock photo aesthetic" — the bigger problem. FLUX was trained
 *      heavily on stock-image catalogs, so unprompted output reads as
 *      "smiling people in business attire, perfectly lit, isolated on
 *      white." Counter with "editorial photography", "shot on Fuji",
 *      "natural imperfections", and explicit negatives ("no stock photo
 *      look, no overly polished, no plastic skin, no studio backdrop").
 *
 * Plus the standard housekeeping:
 *   - "sharp focus" — fights FLUX's occasional soft-focus bug.
 *   - "no text, no watermark, no logos, no signage" — FLUX often
 *     hallucinates cursive shop signs and stock-photo watermarks; this
 *     kills ~90% of those.
 */
export const REALISM_ENFORCER =
  // Positive bias toward real photography
  ", editorial photography style, shot on Fuji X-T4 with 35mm lens at f/2.8" +
  ", photorealistic, sharp focus, natural lighting, natural imperfections" +
  ", subtle film grain, slightly handheld feeling" +
  ", real working environment" +
  // Negative bias against stock-photo aesthetic
  ", NOT a stock photo, NOT advertising photography, NOT staged" +
  ", NOT overly polished, NOT plastic skin, NOT a studio backdrop" +
  ", NOT a perfect smile, NOT smiling at camera, NOT looking at camera" +
  ", NOT cartoon, NOT illustration, NOT 3D render, NOT CGI" +
  // Negative bias against FLUX's hallucinated text/logo failure modes
  ", no text, no watermark, no logos, no signage, no readable writing" +
  ", no fake trademark, no Photoshop overlay, no Instagram filter";

/**
 * Compose the final prompt sent to FLUX. Pure function so it's
 * testable + reusable from any caller (per-field button, future
 * section-batch button, the test script).
 */
export function finalizePrompt(userPrompt: string): string {
  // Idempotency: if the user (or a prior caller) already appended the
  // enforcer, don't double it up. Match by a stable substring ("editorial
  // photography style" + "Fuji X-T4") rather than the whole literal so
  // small comma/spacing tweaks don't bypass the check.
  if (/editorial photography style.*Fuji X-T4/.test(userPrompt))
    return userPrompt;
  return userPrompt.trim() + REALISM_ENFORCER;
}
