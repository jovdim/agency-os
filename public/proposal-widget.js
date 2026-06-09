/**
 * Proposal Widget — GoWebify payment popup.
 * Injected into deployed proposal websites.
 *
 * Presentation: a centered MODAL popup over a dim, lightly-blurred backdrop
 * that opens once per visit, plus a floating "Buy this website" PILL in the
 * bottom-LEFT that reopens it after it's closed.
 *
 * Design matches the real app brand ("calm Linear/Stripe", NOT neon):
 *   - flat near-black surface #121214 with ONE subtle top-left plum wash
 *   - violet #A098EC as the workhorse accent (CTA, strokes), pink #E97AB2
 *     used sparingly (price / one chip). No full-bleed gradient, no aurora.
 *   - signature self-drawing "browser building itself" SVG + spring entrance
 *   - system font, all motion respects prefers-reduced-motion
 *
 * No QR — a single "Buy this website" button (and an "I'd tweak a few
 * things first" path) point at the stable Stripe pay endpoint
 * (/api/public/proposals/<slug>/pay). Clicking mints a fresh Stripe
 * Checkout session and redirects to Stripe; the webhook marks paid.
 *
 * Verbose console logs (prefixed [SK-Widget]) at every decision point.
 */
(function () {
  "use strict";

  var LOG = "[SK-Widget]";

  var currentScript = document.currentScript;
  if (!currentScript) {
    var ss = document.getElementsByTagName("script");
    currentScript = ss[ss.length - 1];
  }
  if (!currentScript) {
    console.warn(LOG, "could not locate own <script> tag — aborting.");
    return;
  }

  var src = currentScript.getAttribute("src") || "";
  var slugMatch = src.match(/[?&]slug=([^&]+)/);
  var slug = slugMatch
    ? decodeURIComponent(slugMatch[1])
    : (currentScript.getAttribute("data-proposal-slug") ||
       currentScript.getAttribute("data-slug") ||
       "");

  if (!slug) {
    console.warn(
      LOG,
      "no slug found. Expected `?slug=…` in script src or data-proposal-slug attribute. src was:",
      src,
    );
    return;
  }

  console.log(LOG, "loaded with slug:", slug);

  var origin = new URL(src, window.location.href).origin;
  var API_URL = origin + "/api/public/proposals/" + slug + "/data";
  var VIEW_URL = origin + "/api/public/proposals/" + slug;
  console.log(LOG, "API URL:", API_URL);

  // System font stack — no web-font dependency on the client's site.
  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  // Detect iframe embedding (Client Zone preview) — hide popup entirely.
  if (window.self !== window.top) {
    console.log(LOG, "running inside an iframe (composer preview / client zone) — hiding popup.");
    document.documentElement.classList.add("is-embedded");
    var embedStyle = document.createElement("style");
    embedStyle.textContent =
      "html.is-embedded #sk-overlay,html.is-embedded #sk-pill{display:none!important;}";
    document.head.appendChild(embedStyle);
    return;
  }

  // Inject styles — refined dark surface, sparing solid accents, the
  // self-drawing browser glyph, spring entrance. No neon, no aurora.
  var style = document.createElement("style");
  style.textContent =
    "@keyframes sk-fade{from{opacity:0}to{opacity:1}}" +
    "@keyframes sk-pop{0%{opacity:0;transform:scale(.88)}55%{opacity:1;transform:scale(1.02)}80%{transform:scale(.995)}100%{transform:scale(1)}}" +
    "@keyframes sk-pillIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}" +
    "@keyframes sk-pillGlow{0%{box-shadow:0 0 0 0 rgba(160,152,236,.55)}70%{box-shadow:0 0 0 14px rgba(160,152,236,0)}100%{box-shadow:0 0 0 0 rgba(160,152,236,0)}}" +
    "@keyframes sk-pillNudge{0%,82%,100%{transform:translateY(0)}90%{transform:translateY(-6px)}96%{transform:translateY(0)}}" +
    "@keyframes sk-sheen{0%{transform:translateX(-120%)}60%,100%{transform:translateX(220%)}}" +
    "@keyframes sk-sheenLoop{0%{transform:translateX(-130%)}22%,100%{transform:translateX(230%)}}" +
    "@keyframes sk-dot{0%,100%{opacity:.5}50%{opacity:1}}" +
    "@keyframes gwDraw{to{stroke-dashoffset:0}}" +
    "@keyframes gwPop{0%{opacity:0;transform:translateY(4px) scale(.96)}60%{opacity:1;transform:translateY(-1px) scale(1.01)}100%{opacity:1;transform:none}}" +
    "@keyframes gwSpin{to{transform:rotate(360deg)}}" +
    "@keyframes gwPulse{0%,100%{opacity:.35;transform:scale(1)}50%{opacity:1;transform:scale(1.35)}}" +
    "#sk-overlay{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(10,10,10,.66);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);font-family:" + FONT + ";}" +
    "#sk-overlay.sk-show{display:flex;animation:sk-fade .25s ease}" +
    "#sk-overlay.sk-show #sk-modal{animation:sk-pop .42s cubic-bezier(.34,1.4,.64,1)}" +
    "#sk-modal{position:relative;width:100%;max-width:420px;max-height:92vh;overflow:hidden;border-radius:22px;background:radial-gradient(120% 120% at 0% 0%,rgba(66,32,76,.55) 0%,rgba(26,20,35,.25) 42%,rgba(18,18,20,0) 72%),#121214;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);color:#FAFAFA;}" +
    "#sk-modal *{box-sizing:border-box}" +
    "#sk-body{max-height:calc(92vh - 4px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(160,152,236,.32) transparent;}" +
    "#sk-body::-webkit-scrollbar{width:8px}" +
    "#sk-body::-webkit-scrollbar-thumb{background:rgba(160,152,236,.28);border-radius:8px;border:2px solid transparent;background-clip:padding-box}" +
    "#sk-body::-webkit-scrollbar-track{background:transparent}" +
    "#sk-close{position:absolute;top:12px;right:12px;z-index:4;width:28px;height:28px;border-radius:9999px;border:none;background:rgba(255,255,255,.06);color:#A1A1A1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s}" +
    "#sk-close:hover{background:rgba(255,255,255,.12);color:#fff}" +
    "#sk-buy-btn{position:relative;overflow:hidden;background:#8275DB;color:#fff;box-shadow:0 6px 20px rgba(130,117,219,.35);transition:transform .18s ease,box-shadow .18s ease,background .18s ease}" +
    "#sk-buy-btn:hover{transform:translateY(-1px);background:#9385E6;box-shadow:0 10px 28px rgba(130,117,219,.5)}" +
    "#sk-buy-btn::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.28) 50%,transparent 70%);transform:translateX(-130%);pointer-events:none;animation:sk-sheenLoop 4.5s ease-in-out infinite}" +
    "#sk-buy-btn:hover::after{animation:sk-sheen 1s ease forwards}" +
    "#sk-buy-btn:hover #sk-rocket{transform:translateX(2px)}" +
    "#sk-rocket{transition:transform .2s ease}" +
    "#sk-edit-btn{transition:color .2s,border-color .2s,background .2s}" +
    "#sk-edit-btn:hover{color:#fff;border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.06)}" +
    "#sk-days-chip{animation:sk-dot 2.4s ease-in-out infinite}" +
    ".gw-frame{stroke-dasharray:1100;stroke-dashoffset:1100;animation:gwDraw 1.6s .1s cubic-bezier(.6,0,.2,1) forwards}" +
    ".gw-block{transform-box:fill-box;transform-origin:center;opacity:0;animation:gwPop .6s cubic-bezier(.22,1,.36,1) forwards}" +
    ".gw-orbit{transform-box:view-box;transform-origin:84px 18px;animation:gwSpin 26s linear infinite}" +
    ".gw-pulse{transform-box:fill-box;transform-origin:center;animation:gwPulse 2.4s ease-in-out infinite}" +
    "#sk-widget-details{overflow:hidden;transition:max-height .45s cubic-bezier(.4,0,.2,1),opacity .35s ease;max-height:0;opacity:0}" +
    "#sk-widget-details.sk-open{max-height:460px;opacity:1}" +
    "#sk-widget-details .sk-check-item{opacity:0;transform:translateY(8px);transition:opacity .3s ease,transform .3s ease}" +
    "#sk-widget-details.sk-open .sk-check-item{opacity:1;transform:none}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(1){transition-delay:.05s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(2){transition-delay:.09s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(3){transition-delay:.13s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(4){transition-delay:.17s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(5){transition-delay:.21s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(6){transition-delay:.25s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(7){transition-delay:.29s}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(8){transition-delay:.33s}" +
    "#sk-toggle{color:#A1A1A1;transition:color .2s}" +
    "#sk-toggle:hover{color:#fff}" +
    "#sk-toggle .sk-arrow{display:inline-block;transition:transform .3s cubic-bezier(.4,0,.2,1)}" +
    "#sk-toggle.sk-open .sk-arrow{transform:rotate(180deg)}" +
    "#sk-pill-wrap{position:fixed;bottom:22px;left:22px;z-index:2147483645;display:none;border-radius:9999px;animation:sk-pillIn .5s cubic-bezier(.16,1,.3,1),sk-pillGlow 2.4s ease-in-out .6s infinite,sk-pillNudge 5.5s ease-in-out 1.2s infinite}" +
    "#sk-pill{position:relative;display:inline-flex;align-items:center;gap:9px;padding:12px 18px;border-radius:9999px;border:1px solid rgba(160,152,236,.55);cursor:pointer;color:#FAFAFA;font-family:" + FONT + ";font-size:14px;font-weight:600;background:#18181B;box-shadow:0 10px 26px rgba(0,0,0,.5);transition:transform .18s,box-shadow .18s,border-color .18s,background .18s}" +
    "#sk-pill:hover{transform:translateY(-2px);border-color:#A098EC;background:#1F1F24;box-shadow:0 14px 34px rgba(0,0,0,.55)}" +
    "@media (prefers-reduced-motion:reduce){#sk-overlay,#sk-overlay.sk-show #sk-modal,#sk-buy-btn::after,#sk-pill,#sk-pill-wrap{animation:none!important}.gw-frame{stroke-dashoffset:0!important}.gw-block{opacity:1!important;transform:none!important}.gw-orbit,.gw-pulse{animation:none!important}}";
  document.head.appendChild(style);

  // Track view (fire-and-forget).
  fetch(VIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "view" }),
  }).catch(function () {});

  // Fetch proposal data + decide whether to render.
  fetch(API_URL)
    .then(function (res) {
      console.log(LOG, "API responded with HTTP", res.status);
      return res.json();
    })
    .then(function (data) {
      console.log(LOG, "API data:", data);
      if (!data.active) {
        console.log(LOG, "API returned active:false — popup hidden.");
        return;
      }
      console.log(LOG, "rendering popup.");
      renderWidget(data);
    })
    .catch(function (err) {
      console.error(LOG, "Failed to load proposal data:", err);
    });

  /**
   * Build the display name line.
   * Companies (s.r.o., a.s., etc.): "Contact Person, Company Name, Town"
   * Self-employed: "Company Name, Town"
   */
  function buildNameLine(contactPerson, companyName, town) {
    var companySuffixes = ["s.r.o", "s. r. o", "a.s.", "a. s.", "z.z.p.o", "k.s.", "v.o.s."];
    var cp = (contactPerson || "").trim();
    var cn = (companyName || "").trim();
    var tw = (town || "").trim();

    var nameLower = cn.toLowerCase();
    var isCompany = false;
    for (var i = 0; i < companySuffixes.length; i++) {
      if (nameLower.indexOf(companySuffixes[i]) !== -1) {
        isCompany = true;
        break;
      }
    }

    var parts = [];
    if (isCompany && cp) {
      parts.push(cp);
      parts.push(cn);
    } else {
      parts.push(cn || cp);
    }
    if (tw) parts.push(tw.charAt(0).toUpperCase() + tw.slice(1).toLowerCase());

    var line = parts.filter(Boolean).join(", ");
    return line || "your business";
  }

  // ── Inline SVGs ──────────────────────────────────────────────────────
  // The signature: a browser window that draws + builds itself once on open.
  var SIGNATURE =
    '<svg width="58" height="51" viewBox="0 0 96 84" fill="none" aria-hidden="true">' +
      '<rect x="4" y="4" width="88" height="76" rx="10" fill="#ffffff" opacity="0.04"/>' +
      '<rect class="gw-frame" x="4" y="4" width="88" height="76" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.5"/>' +
      '<line x1="4" y1="22" x2="92" y2="22" stroke="#ffffff" stroke-opacity="0.14"/>' +
      '<circle cx="12" cy="13" r="2" fill="#A098EC"/>' +
      '<circle cx="20" cy="13" r="2" fill="#E97AB2"/>' +
      '<circle cx="28" cy="13" r="2" fill="#ffffff" fill-opacity="0.30"/>' +
      '<rect class="gw-block" style="animation-delay:1.6s" x="12" y="30" width="34" height="6" rx="3" fill="#ffffff" fill-opacity="0.28"/>' +
      '<rect class="gw-block" style="animation-delay:1.74s" x="12" y="42" width="50" height="16" rx="5" fill="#A098EC" fill-opacity="0.85"/>' +
      '<rect class="gw-block" style="animation-delay:1.88s" x="66" y="42" width="18" height="16" rx="5" fill="#E97AB2" fill-opacity="0.50"/>' +
      '<rect class="gw-block" style="animation-delay:2.02s" x="12" y="64" width="28" height="8" rx="4" fill="#E97AB2"/>' +
      '<rect class="gw-block" style="animation-delay:2.12s" x="44" y="64" width="20" height="8" rx="4" fill="#ffffff" fill-opacity="0.12"/>' +
      '<circle class="gw-orbit" cx="84" cy="18" r="8" fill="none" stroke="#E97AB2" stroke-width="1.5" stroke-dasharray="3 7" opacity="0.8"/>' +
      '<circle class="gw-pulse" cx="10" cy="72" r="3" fill="#A098EC"/>' +
    '</svg>';
  function rocket(color) {
    return '<svg id="sk-rocket" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>' +
      '<path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-3.95 2z"/>' +
      '<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>' +
      '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>';
  }
  var CHECK =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A098EC" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><polyline points="20 6 9 17 4 12"/></svg>';
  var CLOCK =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  var XICON =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function renderWidget(data) {
    var discountActive = data.discountActive;
    var activePrice = data.activePrice;
    var discountPrice = data.discountPrice;
    var basePrice = data.basePrice;
    var expiresAt = data.discountExpiresAt;
    var payUrl = data.payUrl || "#";
    var editUrl = data.magicLoginUrl || (origin + "/login");
    var companyName = data.companyName || "";

    var nameLine = buildNameLine(data.contactPerson, companyName, data.town);

    var diffDays = 0;
    if (expiresAt) {
      var diffMs = new Date(expiresAt) - new Date();
      diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }
    var hasDiscount =
      discountActive && discountPrice && basePrice && discountPrice < basePrice;

    // Price block — pink is reserved for this cluster (price + SAVE chip).
    var priceHtml;
    if (hasDiscount) {
      priceHtml =
        '<div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;">' +
          '<span style="font-size:30px;font-weight:700;color:#34D399;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;">$' + activePrice + '</span>' +
          '<span style="font-size:16px;font-weight:500;color:#737373;text-decoration:line-through;font-variant-numeric:tabular-nums;">$' + basePrice + '</span>' +
        '</div>' +
        '<div style="font-size:12px;font-weight:600;color:#FBBF24;display:flex;align-items:center;gap:5px;margin-top:7px;">' + CLOCK + 'Offer ends in ' + diffDays + ' day' + (diffDays === 1 ? '' : 's') + '.</div>';
    } else {
      priceHtml =
        '<div style="display:flex;align-items:baseline;gap:9px;">' +
          '<span style="font-size:30px;font-weight:700;color:#34D399;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;">$' + activePrice + '</span>' +
          '<span style="font-size:13px;color:#737373;">one-time. you own it.</span>' +
        '</div>';
    }

    // "Everything you get" reveal.
    var detailsId = "sk-widget-details";
    var items = [
      "Your own domain and hosting for the first year",
      "A fast, modern site that looks great on phones",
      "Text, photos and sections tailored to you",
      "A professional email like info@yourcompany.com",
      "SEO basics and an SSL padlock, sorted",
      "A contact form wired straight to your inbox",
      "Google and social media hooked up",
      "Edit it yourself anytime. Renewal next year is just $49",
    ];
    var itemsHtml = "";
    for (var i = 0; i < items.length; i++) {
      var last = i === items.length - 1;
      itemsHtml +=
        '<div class="sk-check-item" style="display:flex;align-items:flex-start;gap:9px;font-size:13.5px;line-height:1.5;padding:7px 0;' +
        (last ? "" : "border-bottom:1px solid rgba(255,255,255,.07);") +
        'color:' + (last ? "#FAFAFA;font-weight:600;" : "#BABAC2;") + '">' +
        CHECK + '<span>' + items[i] + '</span></div>';
    }
    var dropdownContent =
      '<div style="margin:0 22px 4px;padding:4px 16px;background:#171717;border:1px solid rgba(255,255,255,.08);border-radius:12px;">' +
        itemsHtml +
      '</div>';

    // ── Overlay + modal ──
    var overlay = document.createElement("div");
    overlay.id = "sk-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML =
      '<div id="sk-modal">' +
        '<button id="sk-close" type="button" aria-label="Close">' + XICON + '</button>' +

        '<div id="sk-body">' +

          // Header — signature SVG + eyebrow/headline
          '<div style="display:flex;align-items:center;gap:14px;padding:22px 22px 6px;">' +
            '<div style="flex-shrink:0;">' + SIGNATURE + '</div>' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">' +
                '<span style="width:6px;height:6px;border-radius:50%;background:#E97AB2;display:inline-block;flex-shrink:0;"></span>' +
                '<span style="font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#BABAC2;">Built for ' + nameLine + '</span>' +
              '</div>' +
              '<div style="font-size:22px;font-weight:800;line-height:1.15;letter-spacing:-.02em;">Your new website is ready.</div>' +
            '</div>' +
          '</div>' +

          // Subline
          '<div style="padding:2px 22px 0;font-size:13.5px;color:#A1A1A1;line-height:1.55;">Go live on your own domain, and edit it yourself anytime.</div>' +

          // Price
          '<div style="padding:16px 22px 0;">' + priceHtml + '</div>' +

          // CTA
          '<a id="sk-buy-btn" href="' + payUrl + '" target="_top" style="display:flex;align-items:center;justify-content:center;gap:9px;margin:16px 22px 0;padding:13px 20px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;">' +
            rocket("#fff") + 'Buy this website' +
          '</a>' +

          // Secondary — just the "make changes" link, underlined
          '<div style="text-align:center;padding:12px 22px 0;font-size:12px;">' +
            '<a id="sk-edit-btn" href="' + editUrl + '" target="_top" style="color:#A1A1A1;text-decoration:underline;text-underline-offset:3px;font-weight:500;">I want to make some changes first</a>' +
          '</div>' +

          // Toggle
          '<div style="text-align:center;padding:16px 22px 8px;">' +
            '<button id="sk-toggle" type="button" style="background:none;border:none;padding:4px 0;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
              '<span class="sk-toggle-label">See everything you get</span>' +
              '<span class="sk-arrow" style="font-size:8px;">▾</span>' +
            '</button>' +
          '</div>' +

          // Details
          '<div id="' + detailsId + '">' + dropdownContent + '</div>' +

          // Bottom breathing room
          '<div style="height:18px;"></div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // ── Floating reopen pill (bottom-LEFT) ──
    var pillWrap = document.createElement("div");
    pillWrap.id = "sk-pill-wrap";
    var pill = document.createElement("button");
    pill.id = "sk-pill";
    pill.type = "button";
    pill.setAttribute("aria-label", "Buy this website");
    pill.innerHTML =
      rocket("#A098EC") +
      '<span class="sk-pill-label">Buy this website</span>';
    pillWrap.appendChild(pill);
    document.body.appendChild(pillWrap);

    // ── Open / close wiring ──
    var body = document.getElementById("sk-body");
    function openModal() {
      overlay.classList.add("sk-show");
      pillWrap.style.display = "none";
      if (body) body.scrollTop = 0;
    }
    function closeModal() {
      overlay.classList.remove("sk-show");
      pillWrap.style.display = "inline-block";
    }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    var closeBtn = document.getElementById("sk-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("sk-show")) closeModal();
    });
    pill.addEventListener("click", openModal);

    var toggle = document.getElementById("sk-toggle");
    var details = document.getElementById(detailsId);
    if (toggle && details) {
      toggle.addEventListener("click", function () {
        var isOpen = details.classList.toggle("sk-open");
        toggle.classList.toggle("sk-open", isOpen);
        var label = toggle.querySelector(".sk-toggle-label");
        if (label) label.textContent = isOpen ? "Hide the details" : "See everything you get";
        if (isOpen && body) {
          setTimeout(function () { body.scrollTop = body.scrollHeight; }, 320);
        }
      });
    }

    // Auto-open ONCE per browser session (so clicking through pages doesn't
    // re-pop it). After that, the pill is the way back in.
    var SEEN_KEY = "sk-pm-seen-" + slug;
    var seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === "1"; } catch (e) {}
    if (seen) {
      pillWrap.style.display = "inline-block";
    } else {
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch (e) {}
      setTimeout(openModal, 650);
    }
  }
})();
