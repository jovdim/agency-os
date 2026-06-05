"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { House as Home, Plus, X } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import type { CompositionPage } from "@/lib/templates/render";

/**
 * Page basenames (path minus ".html") the system reserves. A user page
 * with one of these names would collide with a file the publisher emits
 * at the deployment root — overwriting (or being overwritten by) it:
 *   - index    → the home page (always exists)
 *   - 404      → the branded not-found page (crawl-files buildNotFoundHtml)
 *   - privacy  → the auto-generated GDPR page (buildPrivacyHtml)
 *   - robots / sitemap / headers → guard against confusion + future
 *     generated files using a `.html` twin. (robots.txt / sitemap.xml /
 *     _headers don't literally collide with a `.html` page today, but
 *     blocking the stems keeps the namespace clean and intent obvious.)
 */
const RESERVED_BASENAMES = new Set([
  "index",
  "404",
  "403",
  "500",
  "privacy",
  "robots",
  "sitemap",
  "headers",
]);

const HOME_PATH = "index.html";

interface Props {
  pages: CompositionPage[];
  activePagePath: string;
  onSwitch: (path: string) => void;
  onAdd: (page: CompositionPage) => void;
  onRemove: (path: string) => void;
  /** When true, the structural controls (Add page button, per-tab ×
   *  remove button) are hidden — clients can navigate between pages
   *  but can't change the page set. Without this prop the whole
   *  strip used to be hidden in client mode, which made subpages
   *  invisible + unreachable from the client zone (Peter 2026-05-30). */
  isClientMode?: boolean;
  /** Services available on the home page (Peter 2026-05-30). When the
   *  tech-admin picks one, the new subpage is auto-named after that
   *  service AND stores the service's id in `linked_service_id` so the
   *  JSON round-trip can tell ChatGPT "this subpage is about service X".
   *  Empty list → only the "Custom" custom option appears.
   *  Composer computes this from composition.pages[0]'s services
   *  section (see homeServiceItems in composer-client.tsx). */
  availableServices?: Array<{ id: string; title: string }>;
  /** Service ids that already have a subpage linked to them (Peter
   *  2026-05-31). These render disabled in the picker with a "(already
   *  assigned)" suffix so the operator sees the full catalog but
   *  can't accidentally link two subpages to the same service. */
  linkedServiceIdsInUse?: Set<string>;
}

const CUSTOM_LINK_SENTINEL = "__custom__";

/** Slugify a service title to a URL-safe page path. Mirrors the rule
 *  inside handleAdd plus diacritics removal so "Rope tree pruning"
 *  becomes "rope-tree-pruning" (with diacritics, "Lanové pílenie" would
 *  otherwise leave dangling dashes). */
function slugifyServiceTitleToPath(title: string): string {
  return title
    .normalize("NFD")
    // Strip combining marks U+0300..U+036F → á → a, č → c, etc.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function PagesTabs({
  pages,
  activePagePath,
  onSwitch,
  onAdd,
  onRemove,
  isClientMode = false,
  availableServices = [],
  linkedServiceIdsInUse,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  // Selected service in the dropdown. CUSTOM_LINK_SENTINEL = "Custom"
  // (no service link). Empty string = nothing picked yet — the user has
  // to make an explicit choice so they don't accidentally submit an
  // un-linked page when they meant to link it.
  const [serviceChoice, setServiceChoice] = useState<string>("");

  /** Reset all add-dialog state. Called on open + after submit so
   *  state doesn't leak between two consecutive "Add page" actions. */
  function resetAddState() {
    setNewPath("");
    setNewLabel("");
    setServiceChoice("");
  }

  /** Service picker change handler. Picking a real service auto-fills
   *  the path + label fields so the tech-admin doesn't have to retype
   *  them. Picking "Custom" leaves the fields untouched so they can
   *  fill manually. The fields stay editable either way — auto-fill
   *  is a starting point, not a lock. */
  function handleServiceChoice(value: string) {
    setServiceChoice(value);
    if (value === "" || value === CUSTOM_LINK_SENTINEL) return;
    const svc = availableServices.find((s) => s.id === value);
    if (!svc) return;
    setNewLabel(svc.title);
    setNewPath(slugifyServiceTitleToPath(svc.title));
  }

  function handleAdd() {
    // Service-link gate: tech-admin must explicitly choose a service
    // OR "Custom" — empty default means they opened the dialog and
    // hit Add without thinking about the link. Silent "no link" by
    // default would be the wrong default (Peter 2026-05-30 wants
    // service subpages to be the common case).
    if (serviceChoice === "") {
      toast.error("Pick a connected service (or Custom for a custom page).");
      return;
    }
    const path = newPath
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!path) {
      toast.error("Page path is required");
      return;
    }
    const finalPath = path.endsWith(".html") ? path : `${path}.html`;
    const basename = finalPath.replace(/\.html$/, "");
    // Length cap — keep filenames + URLs sane (matches subdomain limits).
    if (basename.length > 50) {
      toast.error("Page name is too long (max 50 characters)");
      return;
    }
    // Reserved names — these collide with files the publisher auto-emits
    // at the deployment root (404.html, privacy.html) or with the home
    // page / future generated files. A page named "privacy" would
    // silently overwrite the generated GDPR page on deploy.
    if (RESERVED_BASENAMES.has(basename)) {
      toast.error(
        `"${basename}" is reserved by the system. Pick a different page name.`,
      );
      return;
    }
    if (pages.some((p) => p.path === finalPath)) {
      toast.error("A page with that path already exists");
      return;
    }
    if (!newLabel.trim()) {
      toast.error("Label is required");
      return;
    }
    // Link only when a real service was picked; "Custom" leaves it null.
    const linkedServiceId =
      serviceChoice === CUSTOM_LINK_SENTINEL ? null : serviceChoice;
    onAdd({
      path: finalPath,
      label: newLabel.trim(),
      sections: [],
      linked_service_id: linkedServiceId,
    });
    resetAddState();
    setAdding(false);
  }

  // A client with a single-page site has nothing to navigate — hide the
  // whole strip so it doesn't show a lone, pointless tab. Tech always
  // sees it (they need the "Add page" button to start adding subpages).
  if (isClientMode && pages.length <= 1) return null;

  return (
    <>
      <div className="flex items-center gap-2 border-b dash-hairline bg-card px-3 py-2 overflow-x-auto">
        {/* Segmented control: home page leads with a house icon and is
            always first; the active page reads as a raised solid segment
            while the rest stay quiet until hovered. */}
        <div className="inline-flex items-center gap-1 rounded-full bg-muted/50 p-1">
          {pages.map((p, i) => {
            const isActive = p.path === activePagePath;
            const isHome = p.path === HOME_PATH;
            const showRemove = !isHome && pages.length > 1 && !isClientMode;
            // Thin vertical rule BETWEEN tabs (after every tab except the
            // last) so each page reads as its own item — Home stays distinct
            // from the subpages, and a long list of subpages doesn't blur
            // into one block. No trailing divider after the last tab.
            const showDivider = i < pages.length - 1;
            return (
              <Fragment key={p.path}>
                <div className="group/tab relative shrink-0">
                  <button
                    type="button"
                    onClick={() => onSwitch(p.path)}
                    title={isHome ? `${p.label} · ${p.path}` : p.path}
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "inline-flex items-center gap-1.5 h-7 rounded-full pl-3 text-xs font-medium whitespace-nowrap cursor-pointer transition-all max-w-50",
                      // Keep room on the right for the × so the label doesn't
                      // shift when it fades in on hover.
                      showRemove ? "pr-2" : "pr-3",
                      // Active segment lifts on a calm background with a soft
                      // blurred shadow + a faint violet accent ring/text so it
                      // reads as selected without any hard outline.
                      isActive
                        ? "bg-background text-foreground shadow-[0_1px_4px_-1px_rgba(0,0,0,0.12)] ring-1 ring-[color-mix(in_oklab,var(--dash-accent)_28%,transparent)] dash-accent"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                    ].join(" ")}
                  >
                    {isHome ? (
                      <>
                        <Home className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{p.label}</span>
                      </>
                    ) : (
                      /* Leading "/" hugging the label so subpages read like
                         URL paths (/o-nas) — makes it visually obvious they
                         branch off home. The "/" is muted + non-selectable
                         so it reads as chrome, not part of the label. */
                      <span className="truncate">
                        <span className="text-muted-foreground/60 select-none mr-1">/</span>
                        {p.label}
                      </span>
                    )}

                    {/* Remove × — non-home tabs, tech only. role=button (not a
                        nested <button>, which is invalid) so the click can
                        stopPropagation and not also fire the tab switch. */}
                    {showRemove && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove the "${p.label}" page`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Remove the "${p.label}" page?`)) {
                            onRemove(p.path);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            if (confirm(`Remove the "${p.label}" page?`)) {
                              onRemove(p.path);
                            }
                          }
                        }}
                        className={[
                          "grid place-items-center h-4 w-4 rounded-full cursor-pointer transition-all",
                          "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10",
                          isActive
                            ? "opacity-100"
                            : "opacity-0 group-hover/tab:opacity-100",
                        ].join(" ")}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                </div>

                {/* Separator between tabs — a thin vertical rule so each
                    page reads as its own item (Home from subpages, and
                    subpage from subpage). Omitted after the last tab. */}
                {showDivider && (
                  <span
                    aria-hidden="true"
                    className="mx-0.5 h-4 w-px shrink-0 self-center bg-border/70"
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        {/* Add page — tech only */}
        {!isClientMode && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs shrink-0 rounded-full cursor-pointer text-muted-foreground hover:text-(--dash-accent) hover:bg-[color-mix(in_oklab,var(--dash-accent)_10%,transparent)]"
            onClick={() => {
              resetAddState();
              setAdding(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add page
          </Button>
        )}
      </div>

      <Dialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) resetAddState();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a page</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Connected service picker — drives both the JSON round-trip
                context (so ChatGPT knows which service this subpage is
                about) AND auto-fills path + label as a starting point.
                Required choice: a real service OR Custom. We force the
                tech-admin to think about it rather than defaulting to
                "no link" — Peter wants service subpages to be the
                expected case. Native <select> beats a custom dropdown
                here: short list, two-clicks-to-pick, zero a11y debt. */}
            <div className="space-y-1.5">
              <Label className="text-xs">Connected service</Label>
              <select
                value={serviceChoice}
                onChange={(e) => handleServiceChoice(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--dash-accent)"
              >
                <option value="" disabled>
                  Pick a service…
                </option>
                {availableServices.map((s) => {
                  const alreadyUsed =
                    linkedServiceIdsInUse?.has(s.id) ?? false;
                  return (
                    <option
                      key={s.id}
                      value={s.id}
                      disabled={alreadyUsed}
                    >
                      {s.title}
                      {alreadyUsed ? " (already assigned)" : ""}
                    </option>
                  );
                })}
                {availableServices.length > 0 && (
                  <option disabled>──────</option>
                )}
                <option value={CUSTOM_LINK_SENTINEL}>
                  Custom (no service link)
                </option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                {availableServices.length === 0
                  ? "No services on the home page yet — pick Custom for now, or fill the home services section first."
                  : "Picking a service tells ChatGPT which one this subpage is about when you use the JSON fill."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Path (used in URL)</Label>
              <Input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="about-us"
              />
              <p className="text-[11px] text-muted-foreground">
                Will become {newPath
                  ? newPath.endsWith(".html")
                    ? newPath.toLowerCase()
                    : `${newPath.toLowerCase()}.html`
                  : "<path>.html"}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Label (shown in nav)</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="About us"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAdding(false);
                resetAddState();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd}>Add page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
