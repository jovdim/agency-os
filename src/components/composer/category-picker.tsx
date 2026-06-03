"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const CATEGORY_LABELS: Record<string, string> = {
  hero: "Hero",
  "how-it-works": "How it works",
  about: "About",
  services: "Services",
  gallery: "Gallery",
  reviews: "Reviews",
  faq: "FAQ",
  cta: "Call to action",
  contact: "Contact",
  map: "Map",
  widgets: "Widgets",
};

// Categories the user can ADD as a regular section.
// nav and footer are managed separately via the "shared" section.
// Widgets behave like normal addable sections — multiple per site allowed
// (one WhatsApp button + one scroll-to-top + one cookie bar etc.) — but
// each renders with position: fixed so document order doesn't affect their
// visual placement.
const ADDABLE_CATEGORIES = [
  "hero",
  "how-it-works",
  "about",
  "services",
  "gallery",
  "reviews",
  "faq",
  "cta",
  "contact",
  "map",
  "widgets",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCategories: Set<string>; // categories that have at least one published template
  onPick: (category: string) => void;
}

export function CategoryPicker({
  open,
  onOpenChange,
  availableCategories,
  onPick,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a section</DialogTitle>
          <DialogDescription>
            Pick a section type. You'll then choose a variant.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {ADDABLE_CATEGORIES.map((c) => {
            const enabled = availableCategories.has(c);
            return (
              <button
                key={c}
                disabled={!enabled}
                onClick={() => enabled && onPick(c)}
                className="text-left rounded-md border bg-card p-3 hover:border-primary/50 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  enabled ? "" : `No published ${c} templates — upload one first`
                }
              >
                <p className="text-sm font-medium">{CATEGORY_LABELS[c]}</p>
                {!enabled && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    no templates
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
