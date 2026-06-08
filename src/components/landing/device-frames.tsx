import { ImageSquare, Play, Lock, CaretDown } from "@phosphor-icons/react/ssr";

/**
 * Device-chrome mockups for the landing showcase. They wrap a fixed-ratio
 * "screen" so an empty placeholder already reads as a real product shot, and a
 * real screenshot/video dropped in later slots in at exactly the right size.
 * Pure presentational + CSS hover, no JS.
 */

type ScreenKind = "image" | "video";

/** A faint webpage wireframe so an empty image slot reads as a real screenshot.
 *  Video slots stay clean (just the play affordance), so no skeleton there. */
function PageSkeleton({ kind }: { kind: ScreenKind }) {
  if (kind === "video") return null;
  return (
    <div className="absolute inset-0 z-10 flex flex-col gap-2.5 p-5 opacity-45" aria-hidden>
      <div className="h-3 w-1/3 rounded bg-[color:var(--lp-line2)]" />
      <div className="h-2 w-2/3 rounded bg-[color:var(--lp-line)]" />
      <div className="mt-2 grid flex-1 grid-cols-3 gap-2.5">
        <div className="rounded-lg bg-[color:var(--lp-line)]" />
        <div className="rounded-lg bg-[color:var(--lp-line)]" />
        <div className="rounded-lg bg-[color:var(--lp-line)]" />
      </div>
    </div>
  );
}

/**
 * The fillable slot. Absolutely fills its parent (the frame sets the ratio).
 * Default state labels what goes there; on hover it reveals concrete guidance
 * for the content developer (also exposed via the native title tooltip).
 */
export function Screen({
  kind,
  title,
  hint,
  tip,
  badgeClassName = "left-3 top-3",
}: {
  kind: ScreenKind;
  title: string;
  hint: string;
  tip: string;
  /** Position the corner badge; override to clear the phone notch, etc. */
  badgeClassName?: string;
}) {
  const Icon = kind === "video" ? Play : ImageSquare;
  return (
    <div
      title={tip}
      className="group absolute inset-0 overflow-hidden bg-[color:var(--lp-bg2)]"
    >
      <PageSkeleton kind={kind} />

      <span
        className={`absolute ${badgeClassName} z-40 rounded-md border border-[color:var(--lp-line2)] bg-[color-mix(in_oklab,var(--lp-card)_90%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--lp-muted)] backdrop-blur transition-opacity duration-200 group-hover:opacity-0`}
      >
        {kind === "video" ? "Video" : "Image"} placeholder
      </span>

      {/* default prompt */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center transition-opacity duration-200 group-hover:opacity-0">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand)_22%,var(--lp-card))] text-[color:var(--brand)] shadow-lg ring-1 ring-[color:var(--lp-line2)]">
          <Icon className="h-7 w-7" weight={kind === "video" ? "fill" : "duotone"} />
        </span>
        <div className="max-w-xs">
          <p className="text-sm font-semibold text-[color:var(--lp-text)]">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[color:var(--lp-muted)]">{hint}</p>
        </div>
      </div>

      {/* hover: guidance for the content developer */}
      <div className="absolute inset-0 z-30 flex flex-col justify-center gap-2 bg-[color-mix(in_oklab,var(--lp-bg)_90%,transparent)] p-6 text-left opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--brand-accent)]">
          For the content developer
        </p>
        <p className="text-sm font-bold text-[color:var(--lp-text)]">{title}</p>
        <p className="text-xs leading-relaxed text-[color:var(--lp-muted)]">{tip}</p>
      </div>
    </div>
  );
}

/** A stylised full homepage layout (nav, hero, features, gallery, CTA, footer)
 *  so the scrolling preview reads as a real, complete website design. */
function FullPageWire() {
  const brandSoft = "bg-[color-mix(in_oklab,var(--brand)_32%,var(--lp-card))]";
  const accentSoft = "bg-[color-mix(in_oklab,var(--brand-accent)_32%,var(--lp-card))]";
  const line = "bg-[color:var(--lp-line2)]";
  const soft = "bg-[color:var(--lp-line)]";
  return (
    <div className="flex h-full w-full flex-col">
      {/* nav */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className={`h-3 w-16 rounded ${line}`} />
        <div className="flex gap-2">
          <div className={`h-2.5 w-8 rounded ${soft}`} />
          <div className={`h-2.5 w-8 rounded ${soft}`} />
          <div className={`h-2.5 w-12 rounded ${brandSoft}`} />
        </div>
      </div>
      {/* hero */}
      <div className="flex flex-col gap-3 px-5 py-7">
        <div className={`h-5 w-3/4 rounded ${line}`} />
        <div className={`h-5 w-1/2 rounded ${line}`} />
        <div className={`mt-1 h-2.5 w-2/3 rounded ${soft}`} />
        <div className={`h-2.5 w-1/2 rounded ${soft}`} />
        <div className="mt-2 flex gap-2">
          <div className={`h-7 w-24 rounded-lg ${brandSoft}`} />
          <div className={`h-7 w-20 rounded-lg ${soft}`} />
        </div>
      </div>
      {/* image band */}
      <div className={`mx-5 h-24 rounded-xl ${brandSoft} opacity-70`} />
      {/* features */}
      <div className="grid grid-cols-3 gap-3 px-5 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className={`h-8 w-8 rounded-lg ${accentSoft}`} />
            <div className={`h-2 w-full rounded ${soft}`} />
            <div className={`h-2 w-2/3 rounded ${soft}`} />
          </div>
        ))}
      </div>
      {/* split */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4">
        <div className={`h-28 rounded-xl ${line} opacity-60`} />
        <div className="flex flex-col justify-center gap-2">
          <div className={`h-3 w-1/2 rounded ${line}`} />
          <div className={`h-2 w-full rounded ${soft}`} />
          <div className={`h-2 w-3/4 rounded ${soft}`} />
          <div className={`mt-1 h-6 w-20 rounded-lg ${accentSoft}`} />
        </div>
      </div>
      {/* gallery */}
      <div className="grid grid-cols-3 gap-3 px-5 py-4">
        <div className={`h-16 rounded-lg ${line} opacity-60`} />
        <div className={`h-16 rounded-lg ${line} opacity-60`} />
        <div className={`h-16 rounded-lg ${line} opacity-60`} />
      </div>
      {/* cta band */}
      <div className={`mx-5 my-4 flex flex-col items-center gap-2 rounded-xl ${brandSoft} py-6`}>
        <div className="h-3 w-1/2 rounded bg-white/40" />
        <div className="h-6 w-24 rounded-lg bg-white/30" />
      </div>
      {/* footer */}
      <div className="mt-auto grid grid-cols-4 gap-3 bg-[color:var(--lp-bg)] px-5 py-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className={`h-2 w-12 rounded ${line}`} />
            <div className={`h-1.5 w-full rounded ${soft}`} />
            <div className={`h-1.5 w-2/3 rounded ${soft}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A full-page website preview that lives in a fixed viewport and scrolls its
 * whole length on hover, so a single card shows the entire design, not just the
 * hero. The empty state is a full-page wireframe; drop a real long screenshot in
 * its place later. Guidance for the content developer is in the title tooltip.
 */
export function FullPagePreview({ title, tip }: { title: string; tip: string }) {
  return (
    <div
      title={tip}
      aria-label={title}
      className="group absolute inset-0 overflow-hidden bg-[color:var(--lp-bg2)]"
    >
      {/* tall page that scrolls to reveal its full length on hover */}
      <div className="absolute inset-x-0 top-0 h-[320%] w-full transition-transform duration-[3800ms] ease-in-out group-hover:-translate-y-[68.75%] motion-reduce:transition-none">
        <FullPageWire />
      </div>

      <span className="absolute left-3 top-3 z-40 rounded-md border border-[color:var(--lp-line2)] bg-[color-mix(in_oklab,var(--lp-card)_90%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--lp-muted)] backdrop-blur transition-opacity duration-200 group-hover:opacity-0">
        Full-page image
      </span>

      {/* scroll affordance, fades out while scrolling on hover */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-1.5 bg-gradient-to-t from-[color:var(--lp-bg2)] via-[color-mix(in_oklab,var(--lp-bg2)_60%,transparent)] to-transparent pb-3 pt-12 text-[11px] font-medium text-[color:var(--lp-muted)] transition-opacity duration-200 group-hover:opacity-0">
        <CaretDown className="h-3.5 w-3.5 text-[color:var(--brand-accent)]" weight="bold" />
        Hover to see the full design
      </div>
    </div>
  );
}

/** Mac-style browser window. `screenClassName` sets the screen aspect ratio. */
export function BrowserFrame({
  url = "yourbusiness.com",
  screenClassName = "aspect-[16/10]",
  children,
  className = "",
}: {
  url?: string;
  screenClassName?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-[color:var(--lp-line2)] bg-[color:var(--lp-card2)] shadow-2xl ${className}`}
    >
      <div className="flex items-center gap-3 border-b border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)] px-4 py-2.5">
        <span className="flex shrink-0 gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[color-mix(in_oklab,var(--brand)_65%,white)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[color-mix(in_oklab,var(--brand-accent)_75%,white)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--lp-line2)]" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md border border-[color:var(--lp-line)] bg-[color:var(--lp-bg)] px-2.5 py-1 text-[11px] text-[color:var(--lp-muted)]">
          <Lock className="h-3 w-3 shrink-0 text-[color:var(--brand-accent)]" weight="fill" />
          <span className="truncate">{url}</span>
        </span>
      </div>
      <div className={`relative ${screenClassName}`}>{children}</div>
    </div>
  );
}

/** Portrait phone shell with a notch. Inner screen is ~9:19. */
export function PhoneFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative mx-auto w-full max-w-[330px] rounded-[2.6rem] border border-[color:var(--lp-line2)] bg-[color:var(--lp-card2)] p-3 shadow-2xl ${className}`}
    >
      <div className="absolute left-1/2 top-3 z-40 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-[color:var(--lp-card2)]" />
      <div className="relative aspect-[9/18] overflow-hidden rounded-[2rem] bg-[color:var(--lp-bg2)]">
        {children}
      </div>
    </div>
  );
}
