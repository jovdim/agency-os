/**
 * Proposal Widget — PAY by square (BySquare) QR Code
 * Injected into deployed proposal websites.
 * Top banner with smooth slide-in animation.
 * QR image from official bsqr.co API.
 *
 * Verbose console logs (prefixed [SK-Widget]) at every decision
 * point. To debug a missing banner: open the live site, open
 * devtools → Console, look for the [SK-Widget] lines. The script
 * tells you exactly which check failed.
 */
(function () {
  "use strict";

  var LOG = "[SK-Widget]";

  // Find our own script tag. document.currentScript is the right
  // tool for this and works with `defer` / async; the legacy
  // `scripts[length-1]` heuristic was unreliable once the page
  // had additional inline scripts, which the renderer adds.
  var currentScript = document.currentScript;
  if (!currentScript) {
    var ss = document.getElementsByTagName("script");
    currentScript = ss[ss.length - 1];
  }
  if (!currentScript) {
    console.warn(LOG, "could not locate own <script> tag — aborting.");
    return;
  }

  // Slug can be passed two ways:
  //   1. ?slug=... in the script src URL  (current convention,
  //                                          matches /api/public/...)
  //   2. data-proposal-slug attribute      (older composer
  //                                          deploys 2026-05-10)
  // We accept either so a site deployed under either format
  // continues to work without a republish.
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

  // Load Poppins font
  var fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(fontLink);

  // Detect iframe embedding (Client Zone preview) — hide banner, adjust layout
  if (window.self !== window.top) {
    console.log(LOG, "running inside an iframe (composer preview / client zone) — hiding banner.");
    document.documentElement.classList.add("is-embedded");
    var embedStyle = document.createElement("style");
    embedStyle.textContent =
      "html.is-embedded #sk-proposal-widget{display:none!important;}" +
      "html.is-embedded body{padding-top:0!important;margin-top:0!important;}";
    document.head.appendChild(embedStyle);
    return;
  }

  // Inject CSS animations
  var style = document.createElement("style");
  style.textContent =
    "@keyframes sk-slideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}" +
    "@keyframes sk-fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes sk-pulse{0%,100%{opacity:1}50%{opacity:.6}}" +
    "#sk-proposal-widget{animation:sk-slideDown .5s cubic-bezier(.16,1,.3,1) forwards}" +
    "#sk-widget-details{overflow:hidden;transition:max-height .4s cubic-bezier(.4,0,.2,1),opacity .3s ease;max-height:0;opacity:0;}" +
    "#sk-widget-details.sk-open{max-height:800px;opacity:1;}" +
    "#sk-widget-details .sk-detail-col{opacity:0;transform:translateY(10px);transition:opacity .35s ease,transform .35s ease;}" +
    "#sk-widget-details.sk-open .sk-detail-col:nth-child(1){opacity:1;transform:translateY(0);transition-delay:.1s;}" +
    "#sk-widget-details.sk-open .sk-detail-col:nth-child(2){opacity:1;transform:translateY(0);transition-delay:.2s;}" +
    "#sk-widget-details.sk-open .sk-detail-col:nth-child(3){opacity:1;transform:translateY(0);transition-delay:.3s;}" +
    "#sk-widget-details .sk-check-item{opacity:0;transform:translateX(-8px);transition:opacity .25s ease,transform .25s ease;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(1){opacity:1;transform:translateX(0);transition-delay:.15s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(2){opacity:1;transform:translateX(0);transition-delay:.2s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(3){opacity:1;transform:translateX(0);transition-delay:.25s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(4){opacity:1;transform:translateX(0);transition-delay:.3s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(5){opacity:1;transform:translateX(0);transition-delay:.35s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(6){opacity:1;transform:translateX(0);transition-delay:.4s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(7){opacity:1;transform:translateX(0);transition-delay:.45s;}" +
    "#sk-widget-details.sk-open .sk-check-item:nth-child(8){opacity:1;transform:translateX(0);transition-delay:.5s;}" +
    "#sk-widget-toggle{transition:color .2s,transform .15s;}" +
    "#sk-widget-toggle:hover{color:rgba(255,255,255,.7)!important;}" +
    "#sk-widget-toggle .sk-arrow{display:inline-block;transition:transform .3s cubic-bezier(.4,0,.2,1);}" +
    "#sk-widget-toggle.sk-open .sk-arrow{transform:rotate(180deg);}";
  document.head.appendChild(style);

  // Track view
  fetch(VIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "view" }),
  }).catch(function () {});

  // Fetch proposal data + decide whether to render. The API is the
  // source of truth for visibility now (status check + show_banner
  // toggle live there); see /api/public/proposals/[slug]/data.
  fetch(API_URL)
    .then(function (res) {
      console.log(LOG, "API responded with HTTP", res.status);
      return res.json();
    })
    .then(function (data) {
      console.log(LOG, "API data:", data);
      if (!data.active) {
        console.log(
          LOG,
          "API returned active:false — banner hidden. Common reasons: " +
            "proposal status is not sent/viewed (e.g. still review or already paid), " +
            "or show_banner toggle is OFF on the timeline.",
        );
        return;
      }
      console.log(LOG, "rendering banner.");
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

    if (tw) {
      parts.push(tw.charAt(0).toUpperCase() + tw.slice(1).toLowerCase());
    }

    var line = parts.filter(Boolean).join(", ");
    return line || "vašu firmu";
  }

  function formatIban(iban) {
    if (!iban) return "";
    return iban.replace(/(.{4})/g, "$1 ").trim();
  }

  function renderWidget(data) {
    var container = document.createElement("div");
    container.id = "sk-proposal-widget";

    var discountActive = data.discountActive;
    var activePrice = data.activePrice;
    var discountPrice = data.discountPrice;
    var basePrice = data.basePrice;
    var expiresAt = data.discountExpiresAt;
    var qrImageDataUrl = data.qrImageDataUrl;
    var companyName = data.companyName || "";

    var nameLine = buildNameLine(data.contactPerson, companyName, data.town);

    // Format expiry date and countdown
    var expiryDateStr = "";
    var diffDays = 0;
    if (expiresAt) {
      var now = new Date();
      var expires = new Date(expiresAt);
      var diffMs = expires - now;
      diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      expiryDateStr = expires.getDate() + "." + (expires.getMonth() + 1) + "." + expires.getFullYear();
    }

    // Price line — "Cena 299 € 99 € je konečná. Ak máte záujem..."
    // + "Akciová cena platí ešte X dní"
    var priceHtml = "";
    if (discountActive && discountPrice && basePrice && discountPrice < basePrice) {
      priceHtml =
        '<div style="font-size:14px;font-weight:700;color:#fff;">' +
          'Cena <span style="text-decoration:line-through;color:rgba(255,255,255,0.4);">' + basePrice + " €</span> " +
          '<span style="color:#fff;font-weight:800;">' + activePrice + " €</span>" +
          ' je konečná a platná do <span style="color:rgb(253,224,71);">' + expiryDateStr + "</span>" +
        "</div>" +
        '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;font-weight:400;">' +
          "Ak máte záujem o spustenie webstránky — naskenujte QR kód bankovou aplikáciou." +
        "</div>" +
        '<div style="font-size:11px;color:#e67e22;margin-top:1px;font-weight:500;">' +
          '<svg style="display:inline;vertical-align:-2px;margin-right:3px;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#e67e22" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' +
          "</svg>" +
          "Akciová cena platí ešte " + diffDays + " dní" +
        "</div>";
    } else {
      priceHtml =
        '<div style="font-size:14px;font-weight:700;color:#fff;">' +
          "Cena " + '<span style="font-weight:800;">' + activePrice + " €</span>" +
          " je konečná." +
        "</div>" +
        '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;font-weight:400;">' +
          "Ak máte záujem o spustenie webstránky — naskenujte QR kód bankovou aplikáciou." +
        "</div>";
    }

    // QR image
    var qrHtml = qrImageDataUrl
      ? '<img src="' + qrImageDataUrl + '" alt="PAY by square QR" style="width:110px;height:110px;border-radius:4px;" />'
      : '<div style="width:110px;height:110px;background:rgba(255,255,255,0.08);border-radius:6px;display:flex;align-items:center;justify-content:center;animation:sk-pulse 2s ease-in-out infinite;">' +
        '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="4" height="4"/><line x1="21" y1="14" x2="21" y2="21"/><line x1="14" y1="21" x2="21" y2="21"/></svg>' +
        '</div>';

    // Dropdown content — what we built, what's included, client login
    var detailsId = "sk-widget-details";
    var magicLoginUrl = data.magicLoginUrl;

    var checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>';

    var dropdownContent =
      '<div style="max-width:900px;margin:0 auto;padding:10px 20px 12px;text-align:center;">' +
        '<div style="display:inline-block;text-align:left;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.8;">' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'Dom\u00e9na a hosting na prv\u00fd rok v cene</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'Modern\u00e1 webstr\u00e1nka vr\u00e1tane mobilnej verzie</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'Texty, fotky a sekcie uprav\u00edme pod\u013ea va\u0161ich po\u017eiadaviek</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'Profesion\u00e1lny firemn\u00fd e-mail (napr. info@firma.sk)</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'SEO optimaliz\u00e1cia a SSL certifik\u00e1t</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'Kontaktn\u00fd formul\u00e1r priamo na webstr\u00e1nke</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;">' + checkSvg + 'Napojenie na Google a soci\u00e1lne siete</div>' +
          '<div class="sk-check-item" style="display:flex;align-items:center;gap:6px;color:rgb(253,224,71);">' + checkSvg + 'Pred\u013a\u017eenie na \u010fal\u0161\u00ed rok len 49\u00a0\u20ac</div>' +
        '</div>' +
        '<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:rgba(255,255,255,0.4);line-height:1.5;">' +
          'Po zaplaten\u00ed dostanete e-mail s pr\u00edstupom. Cez v\u00e1\u0161 \u00fa\u010det m\u00f4\u017eete meni\u0165 texty, fotky, prida\u0165 slu\u017eby, \u010doko\u013evek potrebujete.' +
        '</div>' +
      '</div>';

    container.innerHTML =
      '<div style="width:100%;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);' +
      "font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
      'color:#fff;position:relative;z-index:9999;">' +

        // Main row: centered text on left, QR on right
        '<div style="max-width:960px;margin:0 auto;display:flex;align-items:center;padding:6px 20px 2px;gap:20px;">' +

          // Left side — centered text
          '<div style="flex:1;min-width:0;text-align:center;">' +
            '<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:2px;">N\u00e1vrh web str\u00e1nky pre: <span style="color:rgb(253,224,71);">' + nameLine + '</span></div>' +
            priceHtml +
            '<div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:0px;line-height:1;">' +
              '<a href="#" id="sk-cta-order" style="font-size:11px;font-weight:600;color:rgb(253,224,71);text-decoration:none;transition:opacity .2s;" onmouseenter="this.style.opacity=\'0.7\'" onmouseleave="this.style.opacity=\'1\'">Objedna\u0165 webstr\u00e1nku</a>' +
              '<span style="color:rgba(255,255,255,0.15);">|</span>' +
              '<a href="' + (magicLoginUrl || 'https://klient.2dni.sk/login') + '" style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.45);text-decoration:none;transition:opacity .2s;" onmouseenter="this.style.opacity=\'0.7\'" onmouseleave="this.style.opacity=\'1\'">Potrebujem \u00fapravy</a>' +
            "</div>" +
            '<div style="margin-top:-1px;">' +
              '<button id="sk-widget-toggle" style="background:none;border:none;padding:2px 0;font-size:11px;color:rgba(255,255,255,.4);cursor:pointer;display:inline-flex;align-items:center;gap:4px;">' +
                '<span class="sk-arrow" style="font-size:7px;">\u25BC</span> viac inform\u00e1ci\u00ed' +
              '</button>' +
            "</div>" +
          "</div>" +

          // Right side — QR + bank details toggle
          '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;">' +
            '<div style="background:#fff;padding:5px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.25);">' +
              qrHtml +
            "</div>" +
            '<button id="sk-bank-toggle" style="background:none;border:none;font-size:10px;font-weight:500;color:rgba(255,255,255,0.75);cursor:pointer;margin-top:3px;padding:0;text-decoration:underline;">' +
              'Nem\u00f4\u017eete naskenova\u0165?' +
            '</button>' +
            '<div id="sk-bank-details" style="max-height:0;overflow:hidden;opacity:0;transition:max-height .3s ease,opacity .3s ease,margin .3s ease;font-size:11px;color:rgba(255,255,255,0.85);text-align:left;line-height:1.6;">' +
              '<div style="margin-bottom:3px;font-weight:500;color:#fff;">' + (data.beneficiary || '') + '</div>' +
              '<div><span style="color:rgba(255,255,255,0.45);">IBAN:</span> ' + formatIban(data.iban) + '</div>' +
              '<div><span style="color:rgba(255,255,255,0.45);">VS:</span> ' + data.variableSymbol + '</div>' +
              '<div><span style="color:rgba(255,255,255,0.45);">Suma:</span> ' + activePrice + '\u00a0\u20ac</div>' +
            '</div>' +
          "</div>" +

        "</div>" +

        // Expandable details
        '<div id="' + detailsId + '" style="border-top:1px solid rgba(255,255,255,0.08);">' +
          dropdownContent +
        "</div>" +

      "</div>";

    // Insert banner at top — before everything.
    //
    // 2026-05-11 (per Peter, final): banner stays in NORMAL document
    // flow. Renders at the very top of the page on initial load, then
    // scrolls away naturally with content as the visitor scrolls down.
    // NOT sticky, NOT fixed.
    document.body.insertBefore(container, document.body.firstChild);

    // If the page's own nav is `position: fixed`, it would otherwise
    // sit at the top of the viewport and COVER the banner. Demote it to
    // `position: relative` so the nav sits below the banner in normal
    // document flow and both scroll away together. Trade-off: on
    // proposal pages with the banner showing, the page's "sticky nav on
    // scroll" feature is paused. Once payment lands and the banner
    // stops being injected, the nav reverts to its original fixed/
    // sticky behavior automatically (this script doesn't run anymore).
    var nav = document.querySelector("nav, .navbar, [role='navigation']");
    if (nav) {
      var navStyle = window.getComputedStyle(nav);
      if (navStyle.position === "fixed") {
        nav.style.position = "relative";
        // Strip the body padding-top compensation that templates add
        // for fixed navs — no longer needed since nav is in flow now.
        document.body.style.paddingTop = "0";
      }
    }

    // Toggle details with smooth animation
    var toggle = document.getElementById("sk-widget-toggle");
    // "Objednať webstránku" — shake QR code to draw attention
    var orderBtn = document.getElementById("sk-cta-order");
    if (orderBtn) {
      orderBtn.addEventListener("click", function(e) {
        e.preventDefault();
        var qrWrap = container.querySelector("img[alt='PAY by square QR']");
        if (!qrWrap) return;
        var parent = qrWrap.parentElement;
        parent.style.transition = "transform .1s";
        var shakes = ["-4px","4px","-3px","3px","-2px","2px","0"];
        shakes.forEach(function(x, i) {
          setTimeout(function() { parent.style.transform = "translateX(" + x + ")"; }, i * 60);
        });
        qrWrap.style.transition = "box-shadow .3s";
        qrWrap.style.boxShadow = "0 0 16px rgba(253,224,71,0.6)";
        setTimeout(function() { qrWrap.style.boxShadow = "none"; }, 2000);
      });
    }

    var details = document.getElementById(detailsId);
    if (toggle && details) {
      toggle.addEventListener("click", function () {
        var isOpen = details.classList.contains("sk-open");
        if (isOpen) {
          details.classList.remove("sk-open");
          toggle.classList.remove("sk-open");
          toggle.querySelector(".sk-arrow").parentElement.nextSibling.textContent = " Viac informácií";
        } else {
          details.classList.add("sk-open");
          toggle.classList.add("sk-open");
          toggle.querySelector(".sk-arrow").parentElement.nextSibling.textContent = " Skryť informácie";
        }
      });
    }

    // Bank details toggle
    var bankToggle = document.getElementById("sk-bank-toggle");
    var bankDetails = document.getElementById("sk-bank-details");
    if (bankToggle && bankDetails) {
      var bankOpen = false;
      bankToggle.addEventListener("click", function() {
        bankOpen = !bankOpen;
        if (bankOpen) {
          bankDetails.style.maxHeight = bankDetails.scrollHeight + 16 + "px";
          bankDetails.style.opacity = "1";
          bankDetails.style.marginTop = "6px";
        } else {
          bankDetails.style.maxHeight = "0";
          bankDetails.style.opacity = "0";
          bankDetails.style.marginTop = "0";
        }
        bankToggle.textContent = bankOpen ? "Skry\u0165 \u00fadaje" : "Nem\u00f4\u017eete naskenova\u0165?";
      });
      bankToggle.addEventListener("mouseenter", function() {
        bankToggle.style.color = "#fff";
      });
      bankToggle.addEventListener("mouseleave", function() {
        bankToggle.style.color = "rgba(255,255,255,0.75)";
      });
    }
  }
})();
