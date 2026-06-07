/**
 * Inline Editor Script v5 — Webflow-style: all images replaceable, data-field text editable.
 * No DOM wrapping. No layout breakage.
 */

export const INLINE_EDITOR_CSS = `
/* Text fields — blue outline on hover */
[data-field]:hover {
  outline: 2px solid rgba(59, 130, 246, 0.4) !important;
  outline-offset: 2px;
  cursor: pointer;
}
/* Floating pencil label for text — positioned by JS. Instant show (no transition)
   so first-hover always shows feedback — clients don't know to "hover again". */
.sk-text-label {
  position: fixed;
  background: rgba(59, 130, 246, 0.9);
  color: white;
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 99999;
  opacity: 0;
}
/* ALL <img> tags — dim + outline on hover + smooth scale for highlight */
img {
  transition: filter 0.15s, transform 0.3s ease !important;
}
img:hover {
  outline: 2px solid rgba(59, 130, 246, 0.5) !important;
  outline-offset: 2px;
  filter: brightness(0.5) !important;
  cursor: pointer;
}
/* Background-image elements marked as editable */
.sk-bg-img {
  cursor: pointer !important;
  transition: outline 0.15s !important;
}
.sk-bg-img:hover {
  outline: 2px solid rgba(59, 130, 246, 0.5) !important;
  outline-offset: -2px;
}
/* Floating "Replace image" label — positioned by JS. Instant show. */
.sk-img-label {
  position: fixed;
  background: rgba(59, 130, 246, 0.9);
  color: white;
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 20px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 99999;
  opacity: 0;
}
/* Hero "change background" pill — always-visible action chip anchored top-right
   of any hero section. Replaces the hover-anywhere pattern (which was inconsistent
   with how text editing worked in the same area). */
.sk-hero-bg-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 99998;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.92);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 9px 14px;
  border-radius: 999px;
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  transition: transform 0.15s, border-color 0.15s, background 0.15s;
}
.sk-hero-bg-btn:hover {
  background: rgba(15, 23, 42, 1);
  border-color: rgba(59, 130, 246, 0.7);
  transform: translateY(-1px);
}
.sk-hero-bg-btn .sk-hero-icon {
  font-size: 14px;
  line-height: 1;
}
.sk-editor-active {
  outline: 2px solid rgba(59, 130, 246, 1) !important;
  outline-offset: 2px;
  cursor: text;
}
.sk-editor-changed {
  outline: 2px dashed rgba(249, 115, 22, 0.5) !important;
  outline-offset: 2px;
}
.sk-editor-highlight {
  outline: 3px solid rgba(59, 130, 246, 0.8) !important;
  outline-offset: 3px;
}
img.sk-editor-highlight {
  outline: none !important;
  transform: scale(1.05) !important;
  z-index: 10 !important;
  position: relative !important;
}
[contenteditable="true"] {
  min-width: 20px;
  min-height: 1em;
}

/* ── Gallery-specific styling ── */
/* Disable default img:hover darkening for gallery images (they get the button-bar instead) */
[data-gallery] img:hover {
  filter: brightness(0.7) !important;
  outline: 2px solid rgba(59, 130, 246, 0.5) !important;
}
/* Two-button hover bar for gallery images. Instant show — first hover always works. */
.sk-gallery-btns {
  position: fixed;
  display: none;
  gap: 6px;
  z-index: 99999;
  pointer-events: none;
  font-family: -apple-system, system-ui, sans-serif;
}
.sk-gallery-btns.sk-visible {
  display: flex;
  pointer-events: auto;
}
.sk-gallery-btn {
  background: rgba(59, 130, 246, 0.95);
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.sk-gallery-btn.sk-remove {
  background: rgba(239, 68, 68, 0.95);
}
.sk-gallery-btn:hover { transform: translateY(-1px); }

/* Image marked for removal — faded with red strikethrough overlay */
.sk-gallery-removed {
  opacity: 0.35 !important;
  outline: 2px dashed rgba(239, 68, 68, 0.8) !important;
  outline-offset: 2px;
  position: relative;
}
/* Newly added image — green dashed border */
.sk-gallery-added {
  outline: 2px dashed rgba(34, 197, 94, 0.8) !important;
  outline-offset: 2px;
}

/* "+ Add photo" ghost card — matches gallery grid cell */
.sk-gallery-add-card {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  min-height: 120px;
  border: 2px dashed rgba(59, 130, 246, 0.4);
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.04);
  color: rgba(59, 130, 246, 0.85);
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.sk-gallery-add-card:hover {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.8);
}
.sk-gallery-add-card .sk-plus {
  font-size: 28px;
  line-height: 1;
  font-weight: 400;
}
`;

export const INLINE_EDITOR_SCRIPT = `
(function() {
  'use strict';

  var isEditing = false;
  var activeEl = null;
  var originalText = '';
  var galleryBtns = null; // floating 2-button bar for gallery images
  var galleryBtnsTarget = null; // which img the bar is currently attached to
  var addCardIdCounter = 0;

  // ── Gallery helpers ──
  // A "cell" is a direct child of a grid that represents one image slot —
  // either a bare <img> (cert-grid pattern) or a wrapper containing exactly one img
  // (gallery-grid pattern: <figure><a class="glightbox"><img></a></figure>).
  function isImageCell(child) {
    if (!child || child.nodeType !== 1) return false;
    if (child.classList && (child.classList.contains('sk-gallery-add-card') || child.classList.contains('sk-gallery-removed'))) return false;
    if (child.tagName === 'IMG') return true;
    return !!(child.querySelector && child.querySelector('img'));
  }
  function countImageCells(container) {
    if (!container || !container.children) return 0;
    var n = 0;
    for (var i = 0; i < container.children.length; i++) {
      if (isImageCell(container.children[i])) n++;
    }
    return n;
  }
  // Walk up from an img to find the nearest ancestor whose direct children form a multi-image grid.
  function findGridContainer(el) {
    if (!el) return null;
    var cur = el.parentElement;
    while (cur && cur !== document.body) {
      if (cur.closest('nav, header, footer')) { cur = cur.parentElement; continue; }
      if (countImageCells(cur) >= 2) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  // Used by remove/add — returns the actual grid container (not the [data-gallery] anchor).
  function findGalleryContainer(el) {
    if (!el || !el.closest) return null;
    var grid = findGridContainer(el);
    if (grid) return grid;
    return el.closest('[data-gallery]');
  }
  function isGalleryImg(el) {
    if (!el || el.tagName !== 'IMG') return false;
    // Skip nav/header/footer — those are logos, not galleries
    if (el.closest('nav, header, footer')) return false;
    // Explicit: img (or any ancestor) tagged [data-gallery] (GLightbox-style)
    if (el.closest('[data-gallery]')) return true;
    // Implicit: img is part of a multi-image grid (3+ cells)
    var grid = findGridContainer(el);
    return !!(grid && countImageCells(grid) >= 3);
  }
  // Resolve the actual grid container from a [data-gallery] element.
  // Handles BOTH: attribute on outer <section> (drills down) and attribute on inner
  // anchors/figures (walks up to common parent).
  function resolveGalleryGrid(galleryEl) {
    if (!galleryEl) return null;
    // Already a grid?
    if (countImageCells(galleryEl) >= 2) return galleryEl;
    // Drill down: find the deepest descendant that is itself a grid
    var candidates = galleryEl.querySelectorAll('*');
    for (var i = 0; i < candidates.length; i++) {
      if (countImageCells(candidates[i]) >= 2) return candidates[i];
    }
    // Walk up: data-gallery may be on an inner anchor/figure (GLightbox pattern)
    var cur = galleryEl.parentElement;
    while (cur && cur !== document.body) {
      if (countImageCells(cur) >= 2) return cur;
      cur = cur.parentElement;
    }
    return galleryEl;
  }

  // ── Helpers ──

  function generateCssPath(el) {
    if (!el || el === document.body) return 'body';
    var parts = [];
    var cur = el;
    while (cur && cur !== document.body) {
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === cur.tagName; });
        if (siblings.length > 1) tag += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(tag);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function getFieldInfo(el) {
    return {
      cssPath: generateCssPath(el),
      field: el.getAttribute('data-field') || (el.tagName === 'IMG' ? 'image' : null),
      itemId: (function() { var item = el.closest('[data-item]'); return item ? item.getAttribute('data-item') : null; })(),
      section: (function() { var sec = el.closest('[data-section]'); return sec ? sec.getAttribute('data-section') : null; })(),
      elementTag: el.tagName
    };
  }

  // Hero-only bg-image gate: only the hero section is allowed to have its background
  // replaced. Other sections (cyan section, contact section, etc.) keep their CSS
  // backgrounds locked. Hero is identified by any of these markers on or above the el.
  var HERO_SELECTOR = '[data-section="hero"], [data-hero], section.hero, header.hero, .hero, #hero';
  function isInHero(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(HERO_SELECTOR);
  }

  function isBgImage(el) {
    if (!el || !el.classList) return false;
    if (el.classList.contains('sk-bg-img')) return true;
    // Restrict bg-image editing to the hero section only
    if (!isInHero(el)) return false;
    // On-demand detection: check if element has a background-image now
    var bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.indexOf('url(') !== -1 && bg.indexOf('gradient') === -1) {
      el.classList.add('sk-bg-img');
      return true;
    }
    return false;
  }

  function getBgUrl(el) {
    var bg = window.getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') return '';
    return bg.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
  }

  // Hero fallback: when hovering anywhere inside the hero (other than text), the
  // user should still be able to replace the hero image — even if the actual <img>
  // is buried under a gradient/overlay/decorative SVGs and never receives a direct
  // mouse event. Returns the most "hero-like" editable image inside the hero.
  function findHeroImage(target) {
    if (!target || !target.closest) return null;
    var hero = target.closest(HERO_SELECTOR);
    if (!hero) return null;
    // 1. Prefer img with hero-related data-field
    var pref = hero.querySelector('img[data-field*="hero"], img[data-field="image"], img[data-field*="background"]');
    if (pref) return pref;
    // 2. Bg-image element marked editable (CSS background hero)
    if (hero.classList && hero.classList.contains('sk-bg-img')) return hero;
    var bg = hero.querySelector('.sk-bg-img');
    if (bg) return bg;
    // 3. Any img inside the hero
    return hero.querySelector('img');
  }

  // Find what was clicked/hovered
  function findTarget(target) {
    if (!target || target === document.body) return null;
    // Direct hit on img
    if (target.tagName === 'IMG') return target;
    // Background-image element
    if (isBgImage(target)) return target;
    // data-field element = editable text (takes priority)
    if (target.hasAttribute && target.hasAttribute('data-field')) return target;
    var field = target.closest('[data-field]');
    if (field) return field;
    // Walk up the DOM checking each ancestor + siblings for a background-image
    // (hero sections often have overlays / content divs on top of OR next to the bg-image)
    var cursor = target.parentElement;
    while (cursor && cursor !== document.body) {
      if (isBgImage(cursor)) return cursor;
      // At each level, also check siblings (overlay next to bg-image element)
      var sibBg = findBgImageInSiblings(cursor);
      if (sibBg) return sibBg;
      cursor = cursor.parentElement;
    }
    // Check if inside a bg-image element (already marked)
    var bgParent = target.closest('.sk-bg-img');
    if (bgParent) return bgParent;
    // --- Image search: inside target, siblings, parent's siblings ---
    // 1. Inside target (e.g. clicked on div.card-image which contains <img>)
    if (target.querySelector) {
      var innerImg = target.querySelector(':scope > img');
      if (innerImg) return innerImg;
    }
    // 2. Sibling img (e.g. overlay div next to <img>)
    var parent = target.parentElement;
    if (parent) {
      var sibImg = parent.querySelector(':scope > img');
      if (sibImg) return sibImg;
      // 3. Grandparent (e.g. <a> > <div.overlay> > <p>)
      var gp = parent.parentElement;
      if (gp && gp !== document.body) {
        var gpImg = gp.querySelector(':scope > img');
        if (gpImg) return gpImg;
      }
    }
    return null;
  }

  // ── Click = Edit (capture phase so it runs BEFORE link navigation) ──

  document.addEventListener('click', function(e) {
    // Gallery button bar, add-card, and hero-bg pill manage their own clicks
    if (e.target && e.target.closest && (e.target.closest('.sk-gallery-btns') || e.target.closest('.sk-gallery-add-card') || e.target.closest('.sk-hero-bg-btn'))) {
      return;
    }
    // If editing text, clicking outside confirms
    if (isEditing && activeEl) {
      var clicked = findTarget(e.target);
      if (clicked !== activeEl) {
        confirmEdit();
        e.preventDefault();
        return;
      }
    }

    var el = findTarget(e.target);
    // Skip images already marked for removal in this session
    if (el && el.tagName === 'IMG' && el.classList && el.classList.contains('sk-gallery-removed')) {
      e.preventDefault();
      return;
    }

    // Block ALL link navigation (except anchors for smooth scroll)
    var link = e.target.closest('a[href]');
    if (link) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) === '#' && !el) {
        // Allow anchor scroll only if not clicking an editable element
        e.preventDefault();
        var scrollTarget = document.querySelector(href);
        if (scrollTarget) scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Block all other navigation
      e.preventDefault();
    }

    if (!el) return;

    e.preventDefault();

    if (el.tagName === 'IMG' || isBgImage(el)) {
      openImagePicker(el);
    } else {
      startTextEdit(el);
    }
  }, true);

  // ── Text Editing ──

  function startTextEdit(el) {
    if (isEditing && activeEl === el) return;
    if (isEditing) confirmEdit();

    var info = getFieldInfo(el);
    isEditing = true;
    activeEl = el;
    originalText = el.textContent;

    el.classList.add('sk-editor-active');
    el.setAttribute('contenteditable', 'true');
    el.focus();

    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    window.parent.postMessage({
      type: 'TEXT_EDIT_START',
      field: info.field,
      itemId: info.itemId,
      section: info.section,
      cssPath: info.cssPath,
      elementTag: info.elementTag,
      rect: el.getBoundingClientRect(),
      currentText: originalText
    }, '*');
  }

  function confirmEdit() {
    if (!isEditing || !activeEl) return;
    var newText = activeEl.textContent;
    var info = getFieldInfo(activeEl);

    activeEl.removeAttribute('contenteditable');
    activeEl.classList.remove('sk-editor-active');
    if (newText !== originalText) activeEl.classList.add('sk-editor-changed');
    isEditing = false;

    if (newText !== originalText) {
      window.parent.postMessage({
        type: 'TEXT_EDIT_COMPLETE',
        field: info.field, itemId: info.itemId,
        section: info.section,
        cssPath: info.cssPath, elementTag: info.elementTag,
        oldValue: originalText, newValue: newText
      }, '*');
    } else {
      window.parent.postMessage({ type: 'TEXT_EDIT_CANCEL' }, '*');
    }
    activeEl = null;
    originalText = '';
  }

  function cancelEdit() {
    if (!isEditing || !activeEl) return;
    activeEl.textContent = originalText;
    activeEl.removeAttribute('contenteditable');
    activeEl.classList.remove('sk-editor-active');
    isEditing = false;
    activeEl = null;
    originalText = '';
    window.parent.postMessage({ type: 'TEXT_EDIT_CANCEL' }, '*');
  }

  // ── Image Editing ──

  function openImagePicker(el) {
    var info = getFieldInfo(el);
    var isBg = isBgImage(el);
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = function() {
      var file = input.files && input.files[0];
      if (!file) { document.body.removeChild(input); return; }
      var reader = new FileReader();
      reader.onload = function() {
        var dataUrl = reader.result;
        var oldSrc = isBg ? getBgUrl(el) : (el.src || '');
        if (isBg) {
          el.style.backgroundImage = "url('" + dataUrl + "')";
        } else {
          el.src = dataUrl;
        }
        el.classList.add('sk-editor-changed');

        window.parent.postMessage({
          type: 'IMAGE_REPLACED',
          field: info.field, itemId: info.itemId,
          section: info.section,
          cssPath: info.cssPath, elementTag: info.elementTag,
          oldSrc: oldSrc, dataUrl: dataUrl,
          isBgImage: isBg,
          fileName: file.name, fileType: file.type, fileSize: file.size
        }, '*');
      };
      reader.readAsDataURL(file);
      document.body.removeChild(input);
    };
    input.click();
  }

  // ── Gallery: mark removed / add card / upload ──

  function markGalleryImgRemoved(img) {
    if (!img || !img.tagName || img.tagName !== 'IMG') return;
    // For session-added items the change-id lives on the wrapping cell (or on the img itself for flat grids)
    var addedCell = img.closest('.sk-gallery-added') || (img.classList.contains('sk-gallery-added') ? img : null);
    if (addedCell) {
      var changeId = addedCell.getAttribute('data-sk-change-id');
      addedCell.parentElement && addedCell.parentElement.removeChild(addedCell);
      hideAllLabels();
      if (changeId) {
        window.parent.postMessage({ type: 'GALLERY_ADD_REVERTED', changeId: changeId }, '*');
      }
      return;
    }
    var container = findGalleryContainer(img);
    if (!container) return;
    // Resolve gallery id: container, ancestor of container, or any descendant
    var galleryId = container.getAttribute('data-gallery') || '';
    if (!galleryId) {
      var dgEl = img.closest('[data-gallery]') || container.querySelector('[data-gallery]');
      if (dgEl) galleryId = dgEl.getAttribute('data-gallery') || '';
    }
    img.classList.add('sk-gallery-removed');
    hideAllLabels();
    // Compute index among real imgs (skip add-card and removed)
    var siblings = Array.from(container.querySelectorAll(':scope > img, :scope img'));
    var idx = siblings.indexOf(img);
    window.parent.postMessage({
      type: 'GALLERY_IMAGE_REMOVE',
      galleryId: galleryId,
      cssPath: generateCssPath(img),
      imgSrc: img.src || '',
      imgIndex: idx
    }, '*');
  }

  function handleGalleryAddClick(card) {
    var container = card.parentElement;
    if (!container) return;
    // Resolve gallery id: may live on the container itself, or on inner anchors (GLightbox)
    var galleryId = container.getAttribute('data-gallery') || '';
    if (!galleryId) {
      var inner = container.querySelector('[data-gallery]');
      if (inner) galleryId = inner.getAttribute('data-gallery') || '';
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = function() {
      var file = input.files && input.files[0];
      if (!file) { document.body.removeChild(input); return; }
      var reader = new FileReader();
      reader.onload = function() {
        var dataUrl = reader.result;
        var changeId = 'gadd_' + Date.now() + '_' + (addCardIdCounter++);
        // Find a template cell to clone (last non-card, non-removed child that contains an img)
        var templateCell = null;
        for (var i = container.children.length - 1; i >= 0; i--) {
          var c = container.children[i];
          if (c === card) continue;
          if (c.classList && (c.classList.contains('sk-gallery-add-card') || c.classList.contains('sk-gallery-removed'))) continue;
          if (c.tagName === 'IMG' || (c.querySelector && c.querySelector('img'))) { templateCell = c; break; }
        }
        var newCell;
        if (templateCell && templateCell.tagName !== 'IMG') {
          // Clone wrapper structure (e.g. <figure><a><img></a></figure>) so layout/CSS apply
          newCell = templateCell.cloneNode(true);
          var newImg = newCell.querySelector('img');
          if (newImg) {
            newImg.src = dataUrl;
            newImg.removeAttribute('srcset');
            newImg.removeAttribute('width');
            newImg.removeAttribute('height');
            newImg.setAttribute('alt', '');
          }
          var newA = newCell.querySelector('a');
          if (newA) newA.setAttribute('href', dataUrl);
          newCell.removeAttribute('data-item');
          newCell.classList.add('sk-gallery-added');
          newCell.setAttribute('data-sk-change-id', changeId);
        } else {
          // Flat grid (cert-style): just an <img>
          newCell = document.createElement('img');
          newCell.src = dataUrl;
          newCell.className = 'sk-gallery-added';
          newCell.setAttribute('data-sk-change-id', changeId);
        }
        container.insertBefore(newCell, card);
        window.parent.postMessage({
          type: 'GALLERY_IMAGE_ADD',
          galleryId: galleryId,
          galleryCssPath: generateCssPath(container),
          dataUrl: dataUrl,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          changeId: changeId
        }, '*');
      };
      reader.readAsDataURL(file);
      document.body.removeChild(input);
    };
    input.click();
  }

  function attachAddCard(grid, galleryId) {
    if (!grid || grid.querySelector(':scope > .sk-gallery-add-card')) return;
    var card = document.createElement('div');
    card.className = 'sk-gallery-add-card';
    card.setAttribute('data-sk-gallery-id', galleryId || '');
    card.innerHTML = '<span class="sk-plus">+</span><span>Add photo</span>';
    card.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      handleGalleryAddClick(this);
    });
    grid.appendChild(card);
  }

  // Attach a "Change background" pill to every hero section so the user has an obvious,
  // always-visible action for the hero background. Clicking inside the hero on text
  // still edits text — the pill is the ONE place to replace the hero image.
  function attachHeroBgButtons() {
    var heroes = document.querySelectorAll(HERO_SELECTOR);
    for (var i = 0; i < heroes.length; i++) {
      var hero = heroes[i];
      if (hero.querySelector(':scope > .sk-hero-bg-btn')) continue;
      // Only attach if there's actually an editable hero image
      if (!findHeroImage(hero)) continue;
      // Ensure the hero is positioned so the absolute pill anchors correctly
      var pos = window.getComputedStyle(hero).position;
      if (pos === 'static') hero.style.position = 'relative';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sk-hero-bg-btn';
      btn.innerHTML = '<span class="sk-hero-icon">\\u270E</span><span>Change background</span>';
      btn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        var heroEl = this.closest(HERO_SELECTOR);
        if (!heroEl) return;
        var img = findHeroImage(heroEl);
        if (img) openImagePicker(img);
      });
      hero.appendChild(btn);
    }
  }

  function scanGalleries() {
    var seenGrids = [];
    // Explicit: [data-gallery] attribute → resolve to actual grid (handles attr on
    // outer container OR on inner anchors/figures)
    var explicit = document.querySelectorAll('[data-gallery]');
    for (var i = 0; i < explicit.length; i++) {
      var el = explicit[i];
      var grid = resolveGalleryGrid(el);
      if (!grid) continue;
      if (seenGrids.indexOf(grid) !== -1) continue; // dedupe across siblings sharing the same id
      seenGrids.push(grid);
      attachAddCard(grid, el.getAttribute('data-gallery') || '');
    }
    // Auto-detect (flat grids only): div/section/ul with 3+ DIRECT <img> children.
    // We keep this restrictive so service-card grids (3 cards, each containing an icon img)
    // are NOT mistaken for galleries. Nested galleries (figure>a>img) must be marked with
    // [data-gallery] to be picked up — they're handled by the explicit loop above.
    var divs = document.querySelectorAll('div, section, ul');
    for (var j = 0; j < divs.length; j++) {
      var d = divs[j];
      if (seenGrids.indexOf(d) !== -1) continue;
      if (d.closest('nav, header, footer')) continue;
      if (d.closest('[data-gallery]')) continue; // already counted above
      if (d.querySelectorAll(':scope > img').length < 3) continue;
      attachAddCard(d, '');
      seenGrids.push(d);
    }
  }

  // ── Hover labels (image + text) ──

  var imgLabel = null;
  var textLabel = null;
  var hoveredEl = null;

  function createImgLabel() {
    if (imgLabel) return;
    imgLabel = document.createElement('div');
    imgLabel.className = 'sk-img-label';
    imgLabel.textContent = '\\u270E Replace image';
    document.body.appendChild(imgLabel);
  }

  function createTextLabel() {
    if (textLabel) return;
    textLabel = document.createElement('div');
    textLabel.className = 'sk-text-label';
    textLabel.textContent = '\\u270E Edit';
    document.body.appendChild(textLabel);
  }

  function createGalleryBtns() {
    if (galleryBtns) return;
    galleryBtns = document.createElement('div');
    galleryBtns.className = 'sk-gallery-btns';
    var replaceBtn = document.createElement('button');
    replaceBtn.className = 'sk-gallery-btn sk-replace';
    replaceBtn.textContent = '\\u270E Replace';
    replaceBtn.onclick = function(e) {
      e.preventDefault(); e.stopPropagation();
      if (galleryBtnsTarget) openImagePicker(galleryBtnsTarget);
    };
    var removeBtn = document.createElement('button');
    removeBtn.className = 'sk-gallery-btn sk-remove';
    removeBtn.textContent = '\\u2715 Remove';
    removeBtn.onclick = function(e) {
      e.preventDefault(); e.stopPropagation();
      if (galleryBtnsTarget) markGalleryImgRemoved(galleryBtnsTarget);
    };
    galleryBtns.appendChild(replaceBtn);
    galleryBtns.appendChild(removeBtn);
    document.body.appendChild(galleryBtns);
  }

  function clampTop(val) { return Math.max(8, Math.min(val, window.innerHeight - 40)); }
  function clampLeft(val, w) { return Math.max(8, Math.min(val, window.innerWidth - w - 8)); }

  function showImgLabel(el) {
    if (!imgLabel) createImgLabel();
    hideTextLabel();
    hoveredEl = el;
    var rect = el.getBoundingClientRect();
    var top = clampTop(rect.top + rect.height / 2 - 18);
    var left = clampLeft(rect.left + rect.width / 2 - 85, 170);
    imgLabel.style.top = top + 'px';
    imgLabel.style.left = left + 'px';
    imgLabel.style.transform = 'none';
    imgLabel.style.opacity = '1';
  }

  function showTextLabel(el) {
    if (!textLabel) createTextLabel();
    hideImgLabel();
    hoveredEl = el;
    var rect = el.getBoundingClientRect();
    var top = clampTop(rect.top - 28);
    var left = clampLeft(rect.right - 70, 70);
    textLabel.style.top = top + 'px';
    textLabel.style.left = left + 'px';
    textLabel.style.transform = 'none';
    textLabel.style.opacity = '1';
  }

  function showGalleryBtns(img) {
    if (!galleryBtns) createGalleryBtns();
    hideImgLabel();
    hideTextLabel();
    hoveredEl = img;
    galleryBtnsTarget = img;
    var rect = img.getBoundingClientRect();
    // Center horizontally on image, vertically in middle
    // Position first (opacity 0), then toggle visible — guarantees transition even on first hover
    galleryBtns.style.top = clampTop(rect.top + rect.height / 2 - 16) + 'px';
    galleryBtns.style.left = clampLeft(rect.left + rect.width / 2 - 95, 190) + 'px';
    galleryBtns.classList.add('sk-visible');
  }

  function hideGalleryBtns() {
    if (galleryBtns) galleryBtns.classList.remove('sk-visible');
    galleryBtnsTarget = null;
  }

  function hideImgLabel() {
    if (imgLabel) imgLabel.style.opacity = '0';
  }

  function hideTextLabel() {
    if (textLabel) textLabel.style.opacity = '0';
  }

  function hideAllLabels() {
    hideImgLabel();
    hideTextLabel();
    hideGalleryBtns();
    hoveredEl = null;
  }

  // Find a bg-image sibling or sibling's descendant (for overlay-style layouts)
  function findBgImageInSiblings(el) {
    var parent = el.parentElement;
    if (!parent) return null;
    for (var i = 0; i < parent.children.length; i++) {
      var sib = parent.children[i];
      if (sib === el) continue;
      if (isBgImage(sib)) return sib;
      // Check one level down in sibling too
      var desc = sib.querySelector && sib.querySelector('.sk-bg-img');
      if (desc) return desc;
    }
    return null;
  }

  // Resolve hover target to an img or bg-image element
  function findHoverImg(target) {
    if (!target || target === document.body) return null;
    if (target.tagName === 'IMG') return target;
    // Background-image element (isBgImage also runs on-demand detection)
    if (isBgImage(target)) return target;
    // Walk up ancestors checking for background-image
    var cursor = target.parentElement;
    while (cursor && cursor !== document.body) {
      if (isBgImage(cursor)) return cursor;
      // At each level, also check siblings (overlay next to bg-image element)
      var sibBg = findBgImageInSiblings(cursor);
      if (sibBg) return sibBg;
      cursor = cursor.parentElement;
    }
    // Inside target (wrapper div containing img)
    if (target.querySelector) {
      var innerImg = target.querySelector(':scope > img');
      if (innerImg) return innerImg;
      // Also check for nested bg-image
      var innerBg = target.querySelector('.sk-bg-img');
      if (innerBg) return innerBg;
    }
    // Sibling img
    var parent = target.parentElement;
    if (parent) {
      var sibImg = parent.querySelector(':scope > img');
      if (sibImg) return sibImg;
      var gp = parent.parentElement;
      if (gp && gp !== document.body) {
        var gpImg = gp.querySelector(':scope > img');
        if (gpImg) return gpImg;
      }
    }
    return null;
  }

  document.addEventListener('mouseover', function(e) {
    if (isEditing) return;
    var target = e.target;
    if (!target) return;
    // Don't trigger hover labels when over the gallery bar, add-card, or hero pill
    if (target.closest && (target.closest('.sk-gallery-btns') || target.closest('.sk-gallery-add-card') || target.closest('.sk-hero-bg-btn'))) return;
    // Check for image (direct or behind overlay)
    var img = findHoverImg(target);
    if (img) {
      // Don't show hover UI for images already marked as removed
      if (img.classList && img.classList.contains('sk-gallery-removed')) {
        hideAllLabels();
        return;
      }
      if (isGalleryImg(img)) {
        showGalleryBtns(img);
      } else {
        showImgLabel(img);
      }
      return;
    }
    // Text — data-field element
    var field = target.hasAttribute && target.hasAttribute('data-field') ? target : target.closest && target.closest('[data-field]');
    if (field && field.tagName !== 'IMG') {
      showTextLabel(field);
      return;
    }
  });

  document.addEventListener('mouseout', function(e) {
    // Hide when leaving the container area
    var related = e.relatedTarget;
    if (!hoveredEl) return;
    // Check if we're still inside the same image or its overlay container
    if (related && (related === hoveredEl || hoveredEl.contains(related))) return;
    var parent = hoveredEl.parentElement;
    if (related && parent && parent.contains(related)) return;
    // Moving from img to the floating gallery button bar — keep it open
    if (related && related.closest && related.closest('.sk-gallery-btns')) return;
    hideAllLabels();
  });

  // Hide labels on scroll — fixes sticky label
  window.addEventListener('scroll', hideAllLabels, true);

  // ── Keyboard ──

  document.addEventListener('keydown', function(e) {
    if (!isEditing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });

  // ── Parent Messages ──

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case 'UPDATE_IMAGE_SRC': {
        var el = findByData(data);
        if (el) {
          if (el.tagName === 'IMG') el.src = data.src;
          else el.style.backgroundImage = "url('" + data.src + "')";
          el.classList.add('sk-editor-changed');
        }
        break;
      }
      case 'REVERT_FIELD': {
        var el = findByData(data);
        if (!el) break;
        if (data.isImage) {
          if (el.tagName === 'IMG') el.src = data.value;
          else el.style.backgroundImage = "url('" + data.value + "')";
        } else {
          el.textContent = data.value;
        }
        el.classList.remove('sk-editor-changed');
        break;
      }
      case 'APPLY_CHANGE': {
        var el = findByData(data);
        if (!el) break;
        if (data.isImage) {
          if (el.tagName === 'IMG') el.src = data.value;
          else el.style.backgroundImage = "url('" + data.value + "')";
        } else {
          el.textContent = data.value;
        }
        el.classList.add('sk-editor-changed');
        break;
      }
      case 'HIGHLIGHT_ELEMENT': {
        var el = findByData(data);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Wait for scroll to finish, then highlight
          setTimeout(function() {
            el.classList.add('sk-editor-highlight');
            setTimeout(function() { el.classList.remove('sk-editor-highlight'); }, 2000);
          }, 400);
        }
        break;
      }
      case 'SCROLL_TO_SECTION': {
        var s = document.querySelector('[data-section="' + data.sectionId + '"]') || document.getElementById(data.sectionId);
        if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'APPLY_GALLERY_ADD': {
        // Swap the data-URL preview for the permanent uploaded URL
        var previewImg = document.querySelector('img[data-sk-change-id="' + data.changeId + '"]');
        if (previewImg && data.src) previewImg.src = data.src;
        break;
      }
      case 'REVERT_GALLERY_ADD': {
        var addedImg = document.querySelector('img[data-sk-change-id="' + data.changeId + '"]');
        if (addedImg && addedImg.parentElement) addedImg.parentElement.removeChild(addedImg);
        break;
      }
      case 'REVERT_GALLERY_REMOVE': {
        // Find gallery img matching css path or src and un-mark
        var el = null;
        if (data.cssPath) { try { el = document.querySelector(data.cssPath); } catch(e) {} }
        if (el) el.classList.remove('sk-gallery-removed');
        break;
      }
      case 'CONFIRM_EDIT': confirmEdit(); break;
      case 'CANCEL_EDIT': cancelEdit(); break;
    }
  });

  function findByData(data) {
    if (data.field) {
      var sel = '[data-field="' + data.field + '"]';
      if (data.itemId) sel = '[data-item="' + data.itemId + '"] ' + sel;
      var el = document.querySelector(sel);
      if (el) return el;
    }
    if (data.cssPath) {
      try { return document.querySelector(data.cssPath); } catch(e) { return null; }
    }
    return null;
  }

  // ── Page Discovery ──

  function discoverPages() {
    var base = document.querySelector('base');
    var baseUrl = base ? base.getAttribute('href') : window.location.href;
    var baseOrigin;
    try { baseOrigin = new URL(baseUrl).origin; } catch(e) { return; }

    var seen = {};
    var navOrder = [];   // pages found in <nav> — in DOM order
    var otherOrder = []; // pages found outside nav (footer etc.)
    var allLinks = document.querySelectorAll('a[href]');

    for (var i = 0; i < allLinks.length; i++) {
      var a = allLinks[i];
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('tel:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('javascript:') === 0) continue;

      var fullUrl;
      try { fullUrl = new URL(href, baseUrl).toString(); } catch(e) { continue; }
      var parsed;
      try { parsed = new URL(fullUrl); } catch(e) { continue; }
      if (parsed.origin !== baseOrigin) continue;

      var pathname = parsed.pathname;
      var pagePath;
      if (pathname.endsWith('.html')) {
        pagePath = pathname;
        while (pagePath.charAt(0) === '/') pagePath = pagePath.slice(1);
      } else if (pathname.endsWith('/') || pathname === '' || pathname === '/') {
        pagePath = 'index.html';
      } else {
        continue;
      }
      pagePath = pagePath.split('#')[0].split('?')[0];

      var label = (a.textContent || '').trim();
      if (label.length > 60) label = '';
      var isInNav = !!a.closest('nav, header');
      if (!seen[pagePath]) {
        seen[pagePath] = { path: pagePath, label: label, _nav: isInNav };
        if (isInNav) navOrder.push(pagePath);
        else otherOrder.push(pagePath);
      } else if (isInNav && !seen[pagePath]._nav) {
        // Upgrade: was found in footer first, now found in nav — move to nav list
        seen[pagePath] = { path: pagePath, label: label, _nav: true };
        otherOrder = otherOrder.filter(function(p) { return p !== pagePath; });
        navOrder.push(pagePath);
      }
    }

    // Nav pages first (in nav DOM order), then other pages
    var allOrder = navOrder.concat(otherOrder);
    var pages = [];
    for (var oi = 0; oi < allOrder.length; oi++) {
      var entry = seen[allOrder[oi]];
      var finalLabel = entry.label;
      if (!finalLabel) {
        finalLabel = entry.path.split('.html')[0];
        finalLabel = finalLabel.split('-').join(' ').split('_').join(' ');
        finalLabel = finalLabel.split(' ').map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
        if (entry.path === 'index.html') finalLabel = 'Home';
      }
      pages.push({ path: entry.path, label: finalLabel });
    }
    window.parent.postMessage({ type: 'PAGES_DISCOVERED', pages: pages }, '*');
  }

  // ── Scan for background-image elements ──

  function scanBgImages() {
    // Hero-only: scan only descendants of hero markers (and the markers themselves).
    var heroes = document.querySelectorAll(HERO_SELECTOR);
    for (var h = 0; h < heroes.length; h++) {
      var hero = heroes[h];
      var inside = hero.querySelectorAll('section, div, header, footer, a, span, li, [data-field], [data-section]');
      var pool = [hero];
      for (var k = 0; k < inside.length; k++) pool.push(inside[k]);
      for (var i = 0; i < pool.length; i++) {
        var el = pool[i];
        if (el.classList.contains('sk-bg-img')) continue;
        var bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.indexOf('url(') !== -1 && bg.indexOf('gradient') === -1) {
          el.classList.add('sk-bg-img');
        }
      }
    }
  }

  // Watch for runtime changes to inline style (for old sites that set bg via JS onload).
  // Same hero-only gate applies — non-hero bg-image changes are ignored.
  function watchBgImageChanges() {
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'attributes' && m.attributeName === 'style') {
          var el = m.target;
          if (el && el.nodeType === 1 && !el.classList.contains('sk-bg-img') && isInHero(el)) {
            var bg = window.getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && bg.indexOf('url(') !== -1 && bg.indexOf('gradient') === -1) {
              el.classList.add('sk-bg-img');
            }
          }
        }
        // Also re-scan hero region when new elements are added
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          scanBgImages();
        }
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
      subtree: true,
      childList: true,
    });
  }

  // ── Init ──

  var activated = false;
  function activate() {
    if (activated) return;
    activated = true;
    // Pre-create hover labels so first hover shows immediately (no 2-hover bug)
    createImgLabel();
    createTextLabel();
    createGalleryBtns();
    scanBgImages();
    scanGalleries();
    attachHeroBgButtons();
    setTimeout(scanBgImages, 1000);
    setTimeout(scanGalleries, 1000);
    setTimeout(attachHeroBgButtons, 1000);
    setTimeout(scanBgImages, 3000);
    setTimeout(attachHeroBgButtons, 3000);
    setTimeout(scanBgImages, 6000); // catch slow-loading remote backgrounds
    watchBgImageChanges();
    window.parent.postMessage({ type: 'EDITOR_READY' }, '*');
    discoverPages();
    setTimeout(discoverPages, 1500);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(activate, 100);
  } else {
    window.addEventListener('DOMContentLoaded', function() { setTimeout(activate, 100); });
  }
  setTimeout(activate, 2000);
})();
`;
