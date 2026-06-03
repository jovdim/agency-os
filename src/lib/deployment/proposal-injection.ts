const WIDGET_START = "<!-- SK_WIDGET_START -->";
const WIDGET_END = "<!-- SK_WIDGET_END -->";
const CONTACT_START = "<!-- SK_CONTACT_START -->";
const CONTACT_END = "<!-- SK_CONTACT_END -->";
const EDITOR_START = "<!-- SK_EDITOR_START -->";
const EDITOR_END = "<!-- SK_EDITOR_END -->";

// Old markers for backward compat removal
const OLD_START = "<!-- SK_PROPOSAL_START -->";
const OLD_END = "<!-- SK_PROPOSAL_END -->";

/**
 * Fine-grained per-script flags.
 * Each script can be individually toggled on/off by the IT guy.
 */
export interface ScriptFlags {
  paymentWidget: boolean;
  contactHandler: boolean;
  editorHelper: boolean;
}

/**
 * Inject / update scripts on the deployed site's HTML.
 * Always strips existing markers first, then re-inserts the ones that are enabled.
 * Payment widget only goes on index.html (skipped on subpages).
 */
export function injectWidgetScript(
  html: string,
  slug: string,
  dashboardOrigin: string,
  businessEmail?: string | null,
  /** Set true to skip the payment widget (for subpages) */
  skipWidget?: boolean,
  /** Per-script flags. If not provided, defaults to all-on (legacy behavior) */
  flags?: ScriptFlags,
): string {
  const cleaned = removeWidgetScript(html);

  const paymentOn = flags ? flags.paymentWidget : true;
  const contactOn = flags ? flags.contactHandler : true;
  const editorOn = flags ? flags.editorHelper : true;

  const widgetTag =
    paymentOn && !skipWidget
      ? `${WIDGET_START}\n<script src="${dashboardOrigin}/proposal-widget.js?slug=${encodeURIComponent(slug)}"></script>\n${WIDGET_END}`
      : "";

  const contactTag =
    contactOn && businessEmail
      ? `\n${CONTACT_START}\n<script src="${dashboardOrigin}/contact-handler.js" data-email="${businessEmail.replace(/"/g, '&quot;')}"></script>\n${CONTACT_END}`
      : "";

  const editorTag = editorOn
    ? `\n${EDITOR_START}\n<script src="${dashboardOrigin}/editor-helper.js"></script>\n${EDITOR_END}`
    : "";

  // Widget goes after </nav> (needs to be early for banner)
  // Contact handler + editor helper go before </body> (best practice)
  const lateScripts = contactTag + editorTag;

  let result = cleaned;

  // Inject widget after </nav> (banner needs to load early) — skip for subpages
  if (widgetTag) {
    const navClose = /<\/nav>/i;
    if (navClose.test(result)) {
      result = result.replace(navClose, (match) => `${match}\n${widgetTag}`);
    } else {
      // Fallback: after <body>
      const bodyOpen = /<body[^>]*>/i;
      if (bodyOpen.test(result)) {
        result = result.replace(bodyOpen, (match) => `${match}\n${widgetTag}`);
      } else {
        result = widgetTag + "\n" + result;
      }
    }
  }

  // Inject contact handler + editor helper before </body>
  if (lateScripts) {
    const bodyClose = /<\/body>/i;
    if (bodyClose.test(result)) {
      result = result.replace(bodyClose, (match) => `${lateScripts}\n${match}`);
    } else {
      result = result + "\n" + lateScripts;
    }
  }

  return result;
}

/**
 * Remove widget script, contact handler, and old proposal section from HTML.
 */
export function removeWidgetScript(html: string): string {
  let result = removeBetweenMarkers(html, WIDGET_START, WIDGET_END);
  result = removeBetweenMarkers(result, CONTACT_START, CONTACT_END);
  result = removeBetweenMarkers(result, EDITOR_START, EDITOR_END);
  result = removeBetweenMarkers(result, OLD_START, OLD_END);
  return result;
}

function removeBetweenMarkers(
  html: string,
  startMarker: string,
  endMarker: string,
): string {
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return html;
  return html.substring(0, startIdx) + html.substring(endIdx + endMarker.length);
}
