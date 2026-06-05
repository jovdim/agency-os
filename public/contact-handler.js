(function() {
  'use strict';

  // ── Where to POST ──
  // The dashboard origin is derived from this script's own src — it's
  // always served from the dashboard host (e.g. your-app.vercel
  // .app), and /api/public/contact lives there. Falls back to the
  // dashboard production URL if anything weird happens with the script
  // tag (defensive: shouldn't ever trigger in practice).
  var scripts = document.getElementsByTagName('script');
  var thisScript = null;
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.indexOf('contact-handler.js') !== -1) {
      thisScript = scripts[i];
      break;
    }
  }
  var apiBase = thisScript && thisScript.src
    ? thisScript.src.replace(/\/contact-handler\.js.*$/, '')
    : 'https://your-app.vercel.app';

  // Legacy fallback: pre-2026-05-15 builds stamped a `data-email` on
  // the script tag itself (one recipient for the whole site). New
  // builds put the recipient on each <form data-sk-form-recipient>.
  // Honor the old attribute if present, but ONLY when no form on the
  // page carries the new attribute — so a republished site never
  // double-handles its own form.
  var legacyEmail =
    thisScript && thisScript.getAttribute
      ? thisScript.getAttribute('data-email')
      : null;

  var loadTime = Date.now();

  // ── Per-form setup ──
  // Each form gets its recipient email from its OWN data-sk-form-
  // recipient attribute. Falls back to the legacy script-level email
  // when no form carries the new attribute and the script-level value
  // is present. We clone the form before wiring so any pre-existing
  // listeners from a template's script.js (or runtime injected JS)
  // can't intercept submit and bypass our handler.
  function setupForm(originalForm, recipientEmail) {
    if (!recipientEmail) return;
    if (originalForm.dataset.skContactWired === '1') return;

    var form = originalForm.cloneNode(true);
    form.dataset.skContactWired = '1';
    originalForm.parentNode.replaceChild(form, originalForm);

    // Honeypot — bots happily fill any visible input; humans don't see
    // this one (positioned offscreen + zero-sized). Submissions where
    // _hp_check is non-empty are silently accepted by the API so the
    // bot doesn't learn it was flagged.
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = '_hp_check';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0;height:0;width:0;';
    form.appendChild(hp);

    form.addEventListener('submit', function(e) {
      e.preventDefault();

      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (btn && btn.disabled) return;

      // GDPR consent — if the form has a `gdpr_consent` checkbox, we
      // require it to be checked. Slovak SMB sites legally need this
      // (cookies/consent law), so the template ships the checkbox by
      // default and this is the natural place to gate on it.
      var gdprCheckbox = form.querySelector('input[name="gdpr_consent"]');
      if (gdprCheckbox && !gdprCheckbox.checked) {
        showMessage(form, 'Please agree to the processing of your personal data.', 'error');
        return;
      }

      var fd = new FormData(form);
      var data = {};
      fd.forEach(function(val, key) { data[key] = val; });

      // Per-form metadata. `to` overrides any client-side mischief —
      // the API trusts it, but only because it comes from our own
      // attribute on the form (set server-side at render time).
      data.to = recipientEmail;
      data._t = loadTime;

      var origText = '';
      if (btn) {
        origText = btn.textContent || btn.value;
        btn.disabled = true;
        if (btn.textContent !== undefined) btn.textContent = 'Sending...';
        else btn.value = 'Sending...';
      }

      fetch(apiBase + '/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
      .then(function(result) {
        if (result.ok) {
          showMessage(form, 'Your message has been sent. Thank you!', 'success');
          form.reset();
        } else {
          showMessage(form, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
        }
      })
      .catch(function() {
        showMessage(form, 'Something went wrong. Please try again.', 'error');
      })
      .finally(function() {
        if (btn) {
          btn.disabled = false;
          if (btn.textContent !== undefined) btn.textContent = origText;
          else btn.value = origText;
        }
      });
    }, true); // capture phase — beats any other listener attached later
  }

  function showMessage(form, text, type) {
    var existing = form.parentNode.querySelector('.sk-contact-msg');
    if (existing) existing.remove();

    var msg = document.createElement('div');
    msg.className = 'sk-contact-msg';
    msg.style.cssText = 'padding:12px 16px;margin-top:12px;border-radius:8px;font-size:14px;font-weight:500;' +
      (type === 'success'
        ? 'background:#065f46;color:#d1fae5;border:1px solid #10b981;'
        : 'background:#991b1b;color:#fecaca;border:1px solid #ef4444;');
    msg.textContent = text;
    form.parentNode.insertBefore(msg, form.nextSibling);

    setTimeout(function() { if (msg.parentNode) msg.remove(); }, 6000);
  }

  // ── Discovery ──
  // The script is injected by render.ts only when at least one section
  // ships an active form recipient, but the rendered DOM may still
  // arrive empty for a beat if script.js builds the form dynamically
  // (legacy templates do this). We try once immediately, then sit on
  // a MutationObserver until we either find any forms or hit the 10s
  // cap. Each call walks ALL `form[data-sk-form-recipient]` on the
  // page so multi-form sites work without any per-form fiddling.
  function init() {
    var perFormHandled = false;
    var forms = document.querySelectorAll('form[data-sk-form-recipient]');
    forms.forEach(function(f) {
      perFormHandled = true;
      setupForm(f, f.getAttribute('data-sk-form-recipient'));
    });
    // Legacy fallback — only fires when the new attribute is missing
    // everywhere on the page AND the script-tag carries the old email.
    // Targets `#contact-form` (the historical convention) so older
    // republishes keep working through the cutover.
    if (!perFormHandled && legacyEmail) {
      var legacy = document.getElementById('contact-form');
      if (legacy) setupForm(legacy, legacyEmail);
    }
  }

  function waitForForms() {
    init();
    // Even after init() runs we keep an observer alive for a short
    // window in case a template injects its form post-load — script.js
    // patterns Peter has used in the past do exactly this.
    var observer = new MutationObserver(function() {
      init();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function() { observer.disconnect(); }, 10000);
  }

  if (document.readyState === 'complete') {
    waitForForms();
  } else {
    window.addEventListener('load', waitForForms);
  }
})();
