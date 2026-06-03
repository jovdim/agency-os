/**
 * Recreate the pilimestromy.sk site inside the CRM as a normal composer-
 * managed, migrated client.
 *
 * Source of truth = the reference content copied verbatim into
 * scripts/_pilimestromy-content.ts (the site's own site.ts). Nothing here
 * is invented — every string + image comes from that file. This script:
 *
 *   1. Uploads the reference photos to the public `shared-assets` bucket
 *      and builds a basename → public-URL map.
 *   2. Looks up the section_templates IDs by name.
 *   3. Assembles a SiteComposition: shared nav + footer, a home page, and
 *      one subpage per service, each wired with the real content.
 *   4. Creates the full migrated-client stack (contact + auth user +
 *      profile + paid/migrated proposal + site WITH the composition +
 *      payment + credits) using the service-role admin client.
 *
 * Idempotent: re-running deletes the previously created pilimestromy
 * stack (matched by login email) before recreating it.
 *
 * Run:  npx tsx scripts/recreate-pilimestromy.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import crypto from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  site,
  features,
  services,
  testimonials,
  sluzbyPages,
  galleryImages,
} from "./_pilimestromy-content";

config({ path: ".env.local" });

// ── Config ───────────────────────────────────────────────────────────────
const REF_IMAGES_DIR =
  "C:/Users/lorem/Documents/migrate website/pilimestromy/site/public/images";
const LOGIN_EMAIL = site.contact.email; // info@pilimestromy.sk — login + business email
const COMPANY = site.name; // "Pílenie stromov Orava"
const SUBDOMAIN = "pilimestromy";
const CUSTOM_DOMAIN = "pilimestromy.sk";
const ASSET_BUCKET = "shared-assets";
const ASSET_PREFIX = "pilimestromy";

// Coverage cities — from the reference SluzbaPage.astro (not in site.ts).
const CITIES = [
  "Námestovo", "Trstená", "Tvrdošín", "Zuberec", "Zákamenné",
  "Oravská Polhora", "Mútne", "Dolný Kubín", "Liptov", "Žilina",
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Small helpers ──────────────────────────────────────────────────────────
let SEC_COUNTER = 0;
function section(templateId: string, overrides: Record<string, unknown>) {
  const order = SEC_COUNTER++;
  return {
    id: `sec_${Date.now()}_${crypto.randomBytes(3).toString("hex")}_${order}`,
    order,
    template_id: templateId,
    content_overrides: overrides,
  };
}
/** Wrap plain text (possibly multi-paragraph on \n\n) as richtext HTML. */
function rt(text: string): string {
  return text
    .split("\n\n")
    .map((p) => `<p>${p.trim()}</p>`)
    .join("");
}
function link(label: string, href: string) {
  return { label, href };
}

async function main() {
  console.log("== Recreate pilimestromy.sk in CRM ==\n");

  // ── 1. Upload reference images ────────────────────────────────────────
  const files = readdirSync(REF_IMAGES_DIR).filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f));
  // Ensure bucket exists.
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find((b) => b.name === ASSET_BUCKET)) {
    await admin.storage.createBucket(ASSET_BUCKET, { public: true });
    console.log(`created bucket ${ASSET_BUCKET}`);
  }
  const imgUrl: Record<string, string> = {};
  for (const f of files) {
    const bytes = readFileSync(join(REF_IMAGES_DIR, f));
    const ext = f.toLowerCase().split(".").pop()!;
    const ct = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/webp";
    const path = `${ASSET_PREFIX}/${f}`;
    const { error } = await admin.storage.from(ASSET_BUCKET).upload(path, bytes, {
      contentType: ct, upsert: true, cacheControl: "31536000",
    });
    if (error) throw new Error(`image upload failed (${f}): ${error.message}`);
    imgUrl[f] = admin.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  console.log(`uploaded ${files.length} images → ${ASSET_BUCKET}/${ASSET_PREFIX}/`);
  /** Map a reference "/images/x.webp" path to its uploaded public URL. */
  const img = (refPath: string): string => imgUrl[basename(refPath)] ?? "";
  const logoUrl = img("/images/logo.webp");

  // ── 2. Look up template IDs by name ───────────────────────────────────
  const names = [
    "nav-08", "footer-07", "hero-07", "about-09", "services-12", "services-13",
    "gallery-08", "reviews-08", "contact-08",
    "subpage-01", "subpage-02", "subpage-03", "subpage-04", "subpage-05",
    "subpage-06", "subpage-07", "subpage-08", "subpage-09", "subpage-10",
  ];
  const { data: tplRows, error: tplErr } = await admin
    .from("section_templates").select("id, name").in("name", names);
  if (tplErr) throw new Error(`template lookup failed: ${tplErr.message}`);
  const tpl: Record<string, string> = {};
  for (const r of tplRows ?? []) tpl[r.name] = r.id;
  const missing = names.filter((n) => !tpl[n]);
  if (missing.length) throw new Error(`missing templates in section_templates: ${missing.join(", ")}`);
  console.log(`resolved ${names.length} template IDs`);

  // ── 3. Build composition ──────────────────────────────────────────────
  const serviceSlugs = Object.keys(sluzbyPages);

  // Shared nav (nav-08) + footer (footer-07). Nav menu mirrors the
  // reference: Domov / O nás / Služby ▸ (5 service subpages) / Galéria /
  // Referencie / Kontakt. Dropdown links point at the real subpages.
  const serviceNav = Object.keys(sluzbyPages).map((slug) => ({
    label: link(sluzbyPages[slug].breadcrumb, `${slug}.html`),
  }));
  const shared = {
    nav_template_id: tpl["nav-08"],
    nav_overrides: {
      nav_logo: logoUrl,
      nav_phone: link(site.contact.phone, site.contact.phoneHref),
      nav_links: [
        { label: link("Domov", "/#domov"), dropdown_items: [] },
        { label: link("O nás", "/#o-nas"), dropdown_items: [] },
        { label: link("Služby", "/#sluzby"), dropdown_items: serviceNav },
        { label: link("Galéria", "/#galeria"), dropdown_items: [] },
        { label: link("Referencie", "/#recenzie"), dropdown_items: [] },
        { label: link("Kontakt", "/#kontakt"), dropdown_items: [] },
      ],
    },
    footer_template_id: tpl["footer-07"],
    footer_overrides: {
      footer_logo: logoUrl,
      footer_tagline: site.footerTagline,
      footer_address: site.address.full,
      footer_phone: link(site.contact.phone, site.contact.phoneHref),
      footer_email: link(site.contact.email, site.contact.emailHref),
      footer_link_home: link("Domov", "/#domov"),
      footer_link_about: link("O nás", "/#o-nas"),
      footer_link_services: link("Služby", "/#sluzby"),
      footer_link_gallery: link("Galéria", "/#galeria"),
      footer_link_reviews: link("Referencie", "/#recenzie"),
      footer_link_contact: link("Kontakt", "/#kontakt"),
      footer_copyright: `© ${COMPANY}`,
    },
  };

  // Home page sections — finalized pilimestromy-matched templates.
  const homeSections = [
    section(tpl["hero-07"], {
      hero_bg: img(site.hero.image),
      hero_headline: `${site.hero.headingLine1} ${site.hero.headingLine2}`,
      hero_subheadline: rt(site.hero.sub),
      hero_cta_primary: link(site.hero.ctaLabel, site.contact.phoneHref),
      hero_cta_secondary: link("Kontakt", "#kontakt"),
    }),
    section(tpl["about-09"], {
      about_eyebrow: "O nás",
      about_headline: site.tagline,
      about_body: rt(site.about.body),
      // Reference About points (from About.astro's aboutPoints), each with
      // its own icon in the template: axe / shield-check / map-pin.
      about_point_1: "Stromolezecká lanová technika SRT",
      about_point_2: "Bezpečné riešenia v náročnom teréne",
      about_point_3: "Pôsobíme v Žilinskom kraji",
      about_cta_1: link("Naše služby", "#sluzby"),
      about_cta_2: link("Kontakt", "#kontakt"),
      about_image: img(galleryImages[3].src),
      about_video_url: site.about.youtubeEmbed,
    }),
    section(tpl["services-12"], {
      features_eyebrow: "Naše prednosti",
      features_headline: site.features.heading,
      features: features.map((f) => ({ image: img(f.image), title: f.title, description: f.description })),
    }),
    section(tpl["services-13"], {
      services_eyebrow: "Služby",
      services_headline: "Naše služby",
      services_subheadline: rt("Bezpečné a precízne arboristické služby v celom Žilinskom kraji."),
      services: services.map((s) => ({
        image: img(s.image),
        title: s.title,
        description: rt(s.description),
        cta_primary: link("Zistiť viac", `${s.id}.html`),
        cta_more: link("Detail služby", `${s.id}.html`),
      })),
    }),
    section(tpl["gallery-08"], {
      gallery_eyebrow: "Galéria",
      gallery_headline: "Naše práce",
      gallery_subheadline: rt("Ukážky našich realizácií v Žilinskom kraji."),
      gallery_items: galleryImages.map((g) => ({ image: img(g.src) })),
    }),
    section(tpl["reviews-08"], {
      reviews_bg: img(galleryImages[0].src),
      reviews_eyebrow: "Referencie",
      reviews_headline: "Čo hovoria naši zákazníci",
      reviews: testimonials.map((t) => ({ text: rt(t.text), author: t.author })),
    }),
    section(tpl["contact-08"], {
      contact_eyebrow: "Kontakt",
      contact_headline: "Kontaktujte nás",
      contact_text: rt("Zavolajte alebo napíšte. Obhliadka aj cenová ponuka sú zadarmo."),
      contact_company: site.legalName,
      contact_address: site.address.full,
      contact_phone: link(site.contact.phone, site.contact.phoneHref),
      contact_email: link(site.contact.email, site.contact.emailHref),
      contact_whatsapp: link("WhatsApp", site.contact.whatsapp),
      contact_area: site.serviceArea,
      form_recipient_email: site.contact.email,
      form_enabled: true,
      contact_form_headline: "Napíšte nám",
      contact_form_submit: "Odoslať správu",
    }),
  ];

  // One subpage per service.
  const galSrc = galleryImages.map((g) => g.src);
  const subpages = serviceSlugs.map((slug) => {
    const d = sluzbyPages[slug];
    const introImage = galSrc[1];
    const materialsImage = services[services.length - 1].image;
    return {
      path: `${slug}.html`,
      label: d.breadcrumb,
      seo: { title: d.metaTitle, description: d.metaDescription },
      sections: [
        section(tpl["subpage-01"], {
          image: img(d.hero.image), eyebrow: "Služba", title: d.hero.h1, sub: rt(d.hero.sub),
        }),
        section(tpl["subpage-02"], {
          crumb_home: link("Domov", "/"),
          crumb_parent: link("Služby", "/#sluzby"),
          crumb_current: d.breadcrumb,
          eyebrow: "Úvod", heading: d.breadcrumb, body: rt(d.intro), image: img(introImage),
        }),
        section(tpl["subpage-03"], {
          topical_blocks: d.topicalSections.map((s, i) => ({
            heading: s.heading, body: rt(s.body), image: img(galSrc[i % galSrc.length]),
          })),
        }),
        section(tpl["subpage-04"], {
          eyebrow: "Hodnota služby", heading: d.whatsIncluded.heading,
          lead: rt("Bez skrytých položiek. Všetko potrebné je súčasťou jednej dohodnutej ceny."),
          stat_number: String(d.whatsIncluded.items.length),
          stat_caption: "Vecí v cene", stat_label: "Všetko od obhliadky po upratanie",
          items: d.whatsIncluded.items.map((it) => ({ item: it })),
        }),
        section(tpl["subpage-05"], {
          eyebrow: "Pôsobíme v", region: "Žilinský kraj — Orava a Liptov",
          cities: CITIES.map((c) => ({ city: c })),
        }),
        section(tpl["subpage-06"], {
          image: img(materialsImage), eyebrow: "Výbava",
          heading: d.materials.heading, body: rt(d.materials.body),
        }),
        section(tpl["subpage-07"], {
          eyebrow: "Postup spolupráce", heading: d.process.heading,
          steps: d.process.steps.map((s) => ({ title: s.title, body: rt(s.body) })),
          finish_kicker: "Hotovo", finish_label: "Práca dokončená, priestor upratený.",
        }),
        section(tpl["subpage-08"], {
          badge: d.pricing.heading, heading: "Obhliadka a cenová ponuka zadarmo",
          body: rt(d.pricing.body),
          cta_primary: link("Vyžiadať obhliadku", site.contact.phoneHref),
          cta_secondary: link("Napíšte nám", "/#kontakt"),
          trust_caption: "V cene obhliadky",
          trust: [
            { label: "Obhliadka zadarmo" },
            { label: "Pevná suma z obhliadky" },
            { label: "Nezáväzná ponuka" },
          ],
        }),
        section(tpl["subpage-09"], {
          eyebrow: "Otázky a odpovede", heading: "Často kladené otázky",
          faqs: d.faqs.map((f) => ({ question: f.q, answer: rt(f.a) })),
        }),
        section(tpl["subpage-10"], {
          image: img(d.hero.image), eyebrow: "Kontakt", heading: d.finalCTA.heading,
          body: rt(d.finalCTA.body),
          cta_primary: link(site.contact.phone, site.contact.phoneHref),
          cta_secondary: link("WhatsApp", site.contact.whatsapp),
        }),
      ],
    };
  });

  const composition = {
    seo: { title: site.meta.title, description: site.meta.description },
    brand: {
      mode: "custom",
      company_text: COMPANY,
      custom_logo_url: logoUrl,
      phone: site.contact.phone,
      email: site.contact.email,
      address: site.address.full,
    },
    theme: {
      primary: "#16a34a",
      heading_font: "'Inter', sans-serif",
      body_font: "'Inter', sans-serif",
    },
    shared,
    pages: [
      { path: "index.html", label: "Domov", sections: homeSections },
      ...subpages,
    ],
  };
  console.log(`built composition: ${composition.pages.length} pages, ${SEC_COUNTER} sections`);

  // ── 4. Idempotent cleanup of any prior pilimestromy stack ─────────────
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const prior = existingUsers?.users?.find((u) => u.email?.toLowerCase() === LOGIN_EMAIL.toLowerCase());
  if (prior) {
    console.log(`found existing user ${LOGIN_EMAIL} — cleaning up`);
    const { data: priorSites } = await admin.from("sites").select("id, proposal_id").eq("owner_id", prior.id);
    for (const s of priorSites ?? []) {
      await admin.from("sites").delete().eq("id", s.id);
      if (s.proposal_id) await admin.from("proposals").delete().eq("id", s.proposal_id);
    }
    await admin.from("contacts").delete().eq("client_user_id", prior.id);
    await admin.auth.admin.deleteUser(prior.id);
  }
  // Also clear any orphan contact left by a half-failed prior run (created
  // before the auth user was linked). Best-effort — ignore FK errors.
  await admin.from("contacts").delete().eq("email", LOGIN_EMAIL).is("client_user_id", null);

  // ── 5. Create the migrated-client stack ───────────────────────────────
  const tempPassword = crypto.randomBytes(5).toString("hex");
  const variableSymbol = String(Math.floor(1000000000 + Math.abs(crypto.randomBytes(4).readUInt32BE(0)) % 9000000000));

  // Attribution operator — a real staff profile satisfies the NOT NULL FKs
  // (sales_person_id / built_by / assigned_to), same as migrate-client uses
  // the importing user. Falls back to null where the column allows it.
  const { data: staff } = await admin
    .from("profiles").select("id").in("role", ["super_admin", "tech_admin", "administrator"]).limit(1).maybeSingle();
  const operatorId = staff?.id ?? null;

  const { data: contact, error: cErr } = await admin.from("contacts").insert({
    company_name: COMPANY, contact_person: "Jozef", email: LOGIN_EMAIL,
    phone: site.contact.phone.replace(/\s+/g, ""), town: site.address.city,
    industry: "arboristika", status: "converted", client_status: "client",
    business_email: site.contact.email, assigned_to: operatorId,
  }).select("id").single();
  if (cErr || !contact) throw new Error(`contact insert: ${cErr?.message}`);

  const { data: newUser, error: uErr } = await admin.auth.admin.createUser({
    email: LOGIN_EMAIL, password: tempPassword, email_confirm: true,
    user_metadata: { full_name: "Jozef", role: "client" },
  });
  if (uErr || !newUser?.user) throw new Error(`auth create: ${uErr?.message}`);
  const uid = newUser.user.id;

  await admin.from("profiles").update({
    role: "client", full_name: "Jozef", company_name: COMPANY,
    phone: site.contact.phone.replace(/\s+/g, ""),
    // Business email already set up → client zone shows it as done.
    business_email: site.contact.email,
  }).eq("id", uid);

  const { data: proposal, error: pErr } = await admin.from("proposals").insert({
    slug: `pilimestromy-${crypto.randomBytes(3).toString("hex")}`,
    contact_id: contact.id, sales_person_id: operatorId ?? uid, built_by: operatorId ?? uid,
    template_id: null,
    company_name: COMPANY, industry: "arboristika", town: site.address.city,
    services: [], content_overrides: { sections: [] },
    status: "paid", paid_at: new Date().toISOString(), is_migrated: true,
    show_banner: false, price: 299, base_price: 299, discount_price: 299,
    variable_symbol: variableSymbol,
    client_temp_password: tempPassword,
  }).select("id").single();
  if (pErr || !proposal) throw new Error(`proposal insert: ${pErr?.message}`);
  console.log(`  proposal created: ${proposal.id}`);

  console.log("  inserting site…");
  const { data: newSite, error: sErr } = await admin.from("sites").insert({
    name: COMPANY, slug: `${SUBDOMAIN}-${crypto.randomBytes(2).toString("hex")}`,
    subdomain: SUBDOMAIN, domain: CUSTOM_DOMAIN, owner_id: uid, proposal_id: proposal.id,
    status: "live", is_paid: true, is_legacy: false,
    composition,
    // Domain already set up → client zone shows it as done.
    domain_status: "active", requested_domain: CUSTOM_DOMAIN,
    website_live_date: new Date().toISOString().split("T")[0],
    client_temp_password: tempPassword,
  }).select("id").single();
  if (sErr || !newSite) throw new Error(`site insert: ${JSON.stringify(sErr)}`);

  await admin.from("contacts").update({ client_user_id: uid }).eq("id", contact.id);
  await admin.from("payments").insert({
    profile_id: uid, site_id: newSite.id, proposal_id: proposal.id,
    amount: 299, currency: "EUR", payment_method: "bank_transfer", status: "confirmed",
    description: "Migrácia existujúceho klienta (pilimestromy.sk)",
  });
  await admin.from("credit_balances").upsert({ site_id: newSite.id, balance: 50 }, { onConflict: "site_id" });

  console.log("\n✓ DONE");
  console.log(`  proposal_id: ${proposal.id}`);
  console.log(`  site_id:     ${newSite.id}`);
  console.log(`  login:       ${LOGIN_EMAIL}  /  ${tempPassword}`);
  console.log(`  composer:    /tech/proposals/${proposal.id}/composer`);
}

main().catch((e) => { console.error("\n✗ FAILED:", e.message); process.exit(1); });
