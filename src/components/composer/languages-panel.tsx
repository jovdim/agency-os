"use client";

/**
 * Languages panel — the composer tab for multi-language setup.
 *
 * Lets the tech-admin declare the site's main language (the language the
 * current content is written in → renders at the root "/") and enable
 * additional languages (each renders under /<locale>/). For every enabled
 * non-default language a "Translate" button opens the JSON round-trip modal
 * in translate mode; importing the result stores it in
 * composition.i18n.translations[locale] without touching the base content.
 *
 * No-fallback rule (Peter 2026-05-28): an enabled language only goes live
 * once its translation is imported. Until then the panel shows it as
 * "Not translated" and the renderer skips it (see getLocaleRenderTargets
 * onlyPublishable).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Languages, Check, Loader2, Trash2 } from "lucide-react";
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  type SiteI18n,
  type SiteLocale,
} from "@/lib/i18n/locales";

interface Props {
  i18n: SiteI18n | undefined;
  /** Declare which language the base content is in (renders at root). */
  onSetDefault: (locale: SiteLocale) => void;
  /** Enable/disable an additional language. */
  onToggleLocale: (locale: SiteLocale, on: boolean) => void;
  /** Open the translate round-trip modal for this locale. */
  onTranslate: (locale: SiteLocale) => void;
  /** Drop a locale's stored translation (back to "Not translated"). */
  onClearTranslation: (locale: SiteLocale) => void;
}

export function LanguagesPanel({
  i18n,
  onSetDefault,
  onToggleLocale,
  onTranslate,
  onClearTranslation,
}: Props) {
  const defaultLocale: SiteLocale = i18n?.default_locale ?? "sk";
  const enabled = new Set(i18n?.enabled_locales ?? [defaultLocale]);
  // Locale whose translation is pending a delete confirmation. Deleting a
  // translation throws away every translated string for that language, so it
  // goes through a destructive confirm instead of firing on the first click.
  const [confirmClear, setConfirmClear] = useState<SiteLocale | null>(null);
  const isTranslated = (loc: SiteLocale): boolean => {
    const snap = i18n?.translations?.[loc];
    return !!snap && Object.keys(snap).length > 0;
  };

  const additional = SUPPORTED_LOCALES.filter((l) => l !== defaultLocale);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Languages className="h-4 w-4 text-primary" />
          Languages
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The main language is the language the site is built in and is served
          at &quot;/&quot;. Additional languages are served at &quot;/de/&quot;,
          &quot;/en/&quot; and appear in the navbar language switcher.
        </p>
      </div>

      {/* Main language */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Main language (site content)
        </label>
        <select
          value={defaultLocale}
          onChange={(e) => onSetDefault(e.target.value as SiteLocale)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          This is the language the current content is written in. Set it once
          at the start.
        </p>
      </div>

      {/* Additional languages */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-foreground">
          Additional languages
        </div>
        {additional.map((loc) => {
          const on = enabled.has(loc);
          const translated = isTranslated(loc);
          return (
            <div
              key={loc}
              className="rounded-md border p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => onToggleLocale(loc, e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-medium">{LOCALE_LABELS[loc]}</span>
                </label>
                {on &&
                  (translated ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" />
                      Translated
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <Loader2 className="h-3 w-3" />
                      Not translated
                    </span>
                  ))}
              </div>

              {on && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={translated ? "outline" : "default"}
                    className="gap-1.5"
                    onClick={() => onTranslate(loc)}
                  >
                    <Languages className="h-3.5 w-3.5" />
                    {translated ? "Update translation" : "Translate"}
                  </Button>
                  {translated && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => setConfirmClear(loc)}
                      title="Delete the translation for this language"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}

              {on && !translated && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Until it&apos;s translated, this language version won&apos;t
                  be published.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmClear !== null}
        onOpenChange={(o) => !o && setConfirmClear(null)}
        variant="destructive"
        icon={Trash2}
        title={
          confirmClear
            ? `Delete the ${LOCALE_LABELS[confirmClear]} translation?`
            : "Delete translation?"
        }
        description={
          confirmClear
            ? `This permanently removes the translated ${LOCALE_LABELS[confirmClear]} content for this site. That language version stops being published until you translate it again. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete translation"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (confirmClear) onClearTranslation(confirmClear);
          setConfirmClear(null);
        }}
      />
    </div>
  );
}
