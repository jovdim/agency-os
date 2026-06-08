"use client";

import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";
import { HeroVisual } from "./hero-visual";
import { DiscoveryVisual, OrbitRings } from "./landing-visuals";
import { BrowserFrame, PhoneFrame, Screen, FullPagePreview } from "./device-frames";
import { LeadForm } from "./lead-form";
import styles from "./landing.module.css";
import {
  ArrowRight,
  Barbell,
  CaretDown,
  CaretUp,
  Car,
  Check,
  DeviceMobile,
  Drop,
  Envelope,
  FirstAid,
  ForkKnife,
  GlobeHemisphereWest,
  HardHat,
  House,
  Lightning,
  MagicWand,
  MagnifyingGlass,
  PencilSimple,
  Plug,
  Rocket,
  Scales,
  Scissors,
  ShieldCheck,
  Sparkle,
  Storefront,
  Wrench,
} from "@phosphor-icons/react/ssr";

function scrollToProposal() {
  document.getElementById("proposal")?.scrollIntoView({ behavior: "smooth" });
}

type Icon = React.ComponentType<{
  className?: string;
  weight?: "duotone" | "fill" | "bold";
  style?: React.CSSProperties;
}>;

/* ── Small building blocks ─────────────────────────────────────────────── */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--lp-muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand-accent)]" />
      {children}
    </span>
  );
}

/** Floating button that toggles between scroll-to-bottom (near top) and
 *  scroll-to-top (once scrolled down). */
function ScrollToggle() {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label={atTop ? "Scroll to bottom" : "Scroll to top"}
      onClick={() =>
        window.scrollTo({
          top: atTop ? document.documentElement.scrollHeight : 0,
          behavior: "smooth",
        })
      }
      className="fixed bottom-6 right-6 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--lp-line2)] bg-[color-mix(in_oklab,var(--lp-card)_88%,transparent)] text-[color:var(--lp-text)] shadow-xl backdrop-blur transition-all hover:scale-110 hover:border-[color:var(--brand)]"
    >
      {atTop ? (
        <CaretDown className="h-5 w-5" weight="bold" />
      ) : (
        <CaretUp className="h-5 w-5" weight="bold" />
      )}
    </button>
  );
}

function Step({
  n,
  title,
  children,
  icon: IconC,
  delay,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  icon: Icon;
  delay: number;
}) {
  return (
    <Reveal delay={delay} className="h-full">
      <div className="group relative h-full rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[color:var(--lp-line2)]">
        <div className="flex items-center justify-between">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--brand)_24%,var(--lp-card))] text-[color:var(--brand-accent)]">
            <IconC className="h-5 w-5" weight="duotone" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--brand-accent)]">
            Step {n}
          </span>
        </div>
        <h3 className="mt-4 text-base font-bold tracking-tight text-[color:var(--lp-text)]">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--lp-muted)]">{children}</p>
      </div>
    </Reveal>
  );
}

function Feature({
  title,
  children,
  icon: IconC,
  pink,
  delay,
}: {
  title: string;
  children: React.ReactNode;
  icon: Icon;
  pink?: boolean;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <div className="flex gap-4">
        <span
          className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: `color-mix(in oklab, ${pink ? "var(--brand-accent)" : "var(--brand)"} 22%, var(--lp-card))`,
            color: pink ? "var(--brand-accent)" : "color-mix(in oklab, var(--brand) 60%, white)",
          }}
        >
          <IconC className="h-5 w-5" weight="duotone" />
        </span>
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-[color:var(--lp-text)]">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--lp-muted)]">{children}</p>
        </div>
      </div>
    </Reveal>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[color:var(--lp-line)] py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold tracking-tight text-[color:var(--lp-text)]">
        {q}
        <CaretDown className="h-4 w-4 shrink-0 text-[color:var(--brand-accent)] transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <p className={`mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--lp-muted)] ${styles.faqA}`}>{a}</p>
    </details>
  );
}

const SECTORS: { label: string; icon: Icon }[] = [
  { label: "Cafés & restaurants", icon: ForkKnife },
  { label: "Salons & beauty", icon: Scissors },
  { label: "Trades & handymen", icon: Wrench },
  { label: "Construction", icon: HardHat },
  { label: "Electricians", icon: Plug },
  { label: "Plumbing & heating", icon: Drop },
  { label: "Clinics & dental", icon: FirstAid },
  { label: "Fitness & trainers", icon: Barbell },
  { label: "Shops & retail", icon: Storefront },
  { label: "Real estate", icon: House },
  { label: "Law & finance", icon: Scales },
  { label: "Auto & repair", icon: Car },
];

/** One full set of industry chips. Rendered twice in the marquee track (the
 *  second copy hidden from assistive tech) so the loop is seamless. */
function MarqueeGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div aria-hidden={hidden} className="flex shrink-0 items-center gap-2.5 pr-2.5">
      {SECTORS.map(({ label, icon: SecIcon }, i) => (
        <span
          key={label}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] px-3.5 py-2 text-sm font-medium text-[color:var(--lp-text)] shadow-sm"
        >
          <SecIcon
            className="h-4 w-4"
            weight="duotone"
            style={{ color: i % 2 ? "var(--brand-accent)" : "color-mix(in oklab, var(--brand) 65%, white)" }}
          />
          {label}
        </span>
      ))}
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[color:var(--lp-line2)] px-3.5 py-2 text-sm font-medium text-[color:var(--lp-muted)]">
        <Sparkle className="h-4 w-4 text-[color:var(--brand-accent)]" weight="fill" />
        and many more
      </span>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`${styles.page} min-h-screen antialiased`}>
      {/* ── Nav ── */}
      <header
        className={`sticky top-0 z-50 transition-colors duration-300 ${
          scrolled
            ? "border-b border-[color:var(--lp-line)] bg-[color-mix(in_oklab,var(--lp-bg)_82%,transparent)] backdrop-blur-md"
            : "border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
          <button
            type="button"
            aria-label="Back to top"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex cursor-pointer items-center"
          >
            <Brand wordmarkClassName="h-11" />
          </button>
          <nav className="hidden items-center gap-7 text-sm font-medium text-[color:var(--lp-muted)] md:flex">
            <a href="#how" className="transition-colors hover:text-[color:var(--lp-text)]">How it works</a>
            <a href="#features" className="transition-colors hover:text-[color:var(--lp-text)]">What you get</a>
            <a href="#pricing" className="transition-colors hover:text-[color:var(--lp-text)]">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-[color:var(--lp-text)]">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button onClick={scrollToProposal} className="gap-1.5">
              Get a free proposal
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero: marketing pitch (left) + the form with the building-website
          animation living behind it as a backdrop (right) ── */}
      <section id="proposal" className="relative scroll-mt-24 overflow-hidden">
        <div className={styles.aurora} style={{ width: 480, height: 480, top: -170, left: -140 }} />
        <div className={styles.aurora} style={{ width: 420, height: 420, top: 60, right: -150, animationDelay: "3s", opacity: 0.4 }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          {/* LEFT — the pitch */}
          <Reveal>
            <Eyebrow>Websites for small businesses &amp; entrepreneurs</Eyebrow>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-[color:var(--lp-text)] sm:text-5xl lg:text-6xl">
              A website that works
              <br className="hidden sm:block" /> as hard as{" "}
              <span className="relative whitespace-nowrap text-[color:var(--brand-accent)]">
                you do
                <svg className="absolute -bottom-2 left-0 h-3 w-full" viewBox="0 0 200 12" fill="none" preserveAspectRatio="none" aria-hidden>
                  <path className={styles.underline} d="M2 8C40 3 80 3 120 6s60 4 78 1" pathLength={320} stroke="var(--brand-accent)" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>
              .
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--lp-muted)]">
              We design, build, and launch a fast, modern website for your
              business, on your own domain. Then we hand you a dead simple way to
              edit it yourself. One service, done properly.
            </p>
            <ul className="mt-7 space-y-2.5">
              {["Built around your brand", "Live in days", "Edit it yourself, no code"].map((b) => (
                <li key={b} className="flex items-center gap-3 text-[15px] font-medium text-[color:var(--lp-text)]">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-accent)_22%,var(--lp-card))] text-[color:var(--brand-accent)]">
                    <Check className="h-3.5 w-3.5" weight="bold" />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* RIGHT — the form card; the animation lives INSIDE it as a backdrop,
              clipped to the card so it matches the card box exactly */}
          <Reveal delay={160} className="relative">
            {/* orbit rings sit OUTSIDE the card, haloing around it (not clipped) */}
            <OrbitRings className="pointer-events-none absolute left-1/2 top-1/2 h-[125%] w-[125%] -translate-x-1/2 -translate-y-1/2 opacity-50" />
            <div className="relative overflow-hidden rounded-2xl border border-[color:var(--lp-line2)] bg-[color:var(--lp-card)] shadow-2xl">
              {/* building-website SVG backdrop, clipped to the card (faint so
                  the form sits on a solid surface) */}
              <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
                <HeroVisual className={`${styles.drift} w-[140%] max-w-none opacity-[0.12] blur-[1.5px]`} />
              </div>
              {/* form content on top */}
              <div className="relative z-10 p-6 sm:p-7">
                <div className="mb-5 text-center">
                  <h2 className="text-xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-2xl">
                    Get your free proposal
                  </h2>
                  <p className="mt-1 text-sm text-[color:var(--lp-muted)]">
                    Fill out the form and we reply within one business day, with zero obligation.
                  </p>
                </div>
                <LeadForm />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Industries we build for (slow marquee) ── */}
      <section className="overflow-hidden border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)] py-12 lg:py-16">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <div className="flex justify-center">
            <Eyebrow>Every kind of local business</Eyebrow>
          </div>
          <h2 className="mx-auto mt-4 max-w-2xl text-balance text-xl font-bold tracking-tight text-[color:var(--lp-text)] sm:text-2xl">
            From the corner café to the construction site, and everything in between.
          </h2>
        </div>
        <div className="relative mt-9 flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_7%,black_93%,transparent)]">
          <div className={`${styles.marquee} flex w-max`}>
            <MarqueeGroup />
            <MarqueeGroup hidden />
          </div>
        </div>
      </section>

      {/* ── Design directions (capability, not client proof) ── */}
      <section className="relative scroll-mt-24 overflow-hidden">
        <div className={styles.aurora} style={{ width: 460, height: 460, top: -120, right: -150, opacity: 0.28 }} />
        <div className="relative mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <Reveal className="max-w-2xl">
            <Eyebrow>Your design</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              A look that fits your business, whatever it does.
            </h2>
            <p className="mt-4 text-lg text-[color:var(--lp-muted)]">
              We shape the design around your trade and the customers you want to
              reach. Here are a few directions to show the range, then we build
              yours to match.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-x-7 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { style: "Bold & modern", desc: "High contrast and big type, made to stand out." },
              { style: "Warm & local", desc: "Friendly and inviting, built to earn trust." },
              { style: "Clean & minimal", desc: "Calm and spacious, lets your work speak." },
            ].map((s, i) => (
              <Reveal key={s.style} delay={(i % 3) * 90}>
                <div className="group">
                  <BrowserFrame
                    url="yourbusiness.com"
                    screenClassName="aspect-[16/10]"
                    className="transition-transform duration-200 group-hover:-translate-y-1"
                  >
                    <FullPagePreview
                      title={s.style}
                      tip="A screenshot of the FULL homepage in this style, top to bottom (a long, full-page capture, not just the hero). It scrolls inside the frame on hover, so visitors see the whole design. Export it at desktop width, around 1440px wide, as one tall image."
                    />
                  </BrowserFrame>
                  <div className="mt-3.5 px-1">
                    <p className="text-sm font-bold tracking-tight text-[color:var(--lp-text)]">{s.style}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--lp-muted)]">{s.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={280} className="mt-10">
            <p className="text-sm text-[color:var(--lp-muted)]">
              Not sure which suits you? We will recommend the right direction in
              your free proposal.{" "}
              <button onClick={scrollToProposal} className="font-semibold text-[color:var(--brand-accent)] underline-offset-4 hover:underline">
                Get your free proposal
              </button>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Value / discovery radar ── */}
      <section className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>Why it matters</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              Customers check you out online{" "}
              <span className="text-[color:var(--brand)]">before</span> they ever call.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[color:var(--lp-muted)]">
              If they cannot find you, or they land on something slow and dated,
              they quietly move on to the next name on the list. A sharp, fast
              website is the difference between looking established and getting
              skipped. It is the one thing we make, and we make it properly.
            </p>
          </Reveal>
          <Reveal delay={140} className="relative flex justify-center">
            <div className={styles.aurora} style={{ width: 300, height: 300, top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: 0.3 }} />
            <DiscoveryVisual className="relative w-full max-w-sm" />
          </Reveal>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="scroll-mt-24 border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)]">
        <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <Reveal className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              From first hello to live website, in four simple steps.
            </h2>
            <p className="mt-4 text-lg text-[color:var(--lp-muted)]">
              No briefs to write, no jargon, no project management. You talk, we
              build, you approve, it goes live.
            </p>
          </Reveal>

          <div className="relative mt-12">
            <div className="pointer-events-none absolute inset-x-[8%] top-[58px] z-0 hidden lg:block">
              <div className="border-t border-dashed border-[color:var(--lp-line2)]" />
              <div
                className={`${styles.connDot} absolute top-0 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[color:var(--brand-accent)]`}
                style={{ boxShadow: "0 0 14px var(--brand-accent)" }}
              />
            </div>

            <div className="relative z-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Step n="01" title="Tell us about you" icon={Storefront} delay={0}>
                Send a few lines about your business through the free proposal
                form. We come back with a plan and a price, with no obligation.
              </Step>
              <Step n="02" title="We build it" icon={MagicWand} delay={80}>
                We tailor a clean, modern design around your brand, your words,
                and the customers you want to reach.
              </Step>
              <Step n="03" title="Review it live" icon={PencilSimple} delay={160}>
                See the real thing on a live link. Want changes? Point them out
                and we refine it until it feels right.
              </Step>
              <Step n="04" title="Go live" icon={Rocket} delay={240}>
                We launch on your own domain with hosting and SSL handled. You
                are online, usually within days.
              </Step>
            </div>
          </div>
        </div>
      </section>

      {/* ── Self-serve editing demo (the hook: one big, central video) ── */}
      <section className="relative scroll-mt-24 overflow-hidden">
        <div className="relative mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <Reveal className="max-w-2xl">
            <Eyebrow>See it in action</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              Edit your own website. No developer, no waiting.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[color:var(--lp-muted)]">
              Once your site is live, you are in control. Click any text or image
              right on your own website and change it in seconds. New prices, new
              hours, a fresh photo, all without touching code or paying for an edit.
            </p>
          </Reveal>

          <Reveal delay={120} className="relative mx-auto mt-12 max-w-5xl">
            <div className={styles.aurora} style={{ width: 520, height: 520, top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: 0.2 }} />
            <BrowserFrame url="yourbusiness.com" screenClassName="aspect-video" className="relative">
              <Screen
                kind="video"
                title="Editing your site, live"
                hint="About a 60-second screen recording"
                tip="Screen record the live editor: hover a heading, click it, change the text or a price, then click an image and swap it, and finish on it saving and going live. 45 to 75 seconds, 16:9, no audio needed (add captions). A looping MP4 or a YouTube embed both fit this frame."
              />
            </BrowserFrame>
          </Reveal>

          <Reveal delay={180} className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-3">
            {[
              "Click any text or image to change it",
              "Your changes go live in moments",
              "No code, no dashboard to learn",
            ].map((b) => (
              <div
                key={b}
                className="flex items-center gap-3 rounded-xl border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] px-4 py-3 text-sm font-medium text-[color:var(--lp-text)]"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-accent)_22%,var(--lp-card))] text-[color:var(--brand-accent)]">
                  <Check className="h-3.5 w-3.5" weight="bold" />
                </span>
                {b}
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative scroll-mt-24 overflow-hidden">
        <OrbitRings className="pointer-events-none absolute -right-20 top-6 hidden h-80 w-80 opacity-40 lg:block" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <Reveal className="max-w-2xl">
            <Eyebrow>What you get</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              One website. Everything it needs to pull its weight.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
            <Feature title="Designed around your brand" icon={Sparkle} delay={0}>
              We start from proven, high converting layouts and tailor them to
              your business, so it looks the part from day one.
            </Feature>
            <Feature title="Your own domain, hosting and SSL" icon={GlobeHemisphereWest} pink delay={80}>
              Launched on your domain with secure hosting included. It is your
              site, your address, your asset, for good.
            </Feature>
            <Feature title="Leads land in your inbox" icon={Envelope} delay={160}>
              A built in contact form sends every enquiry straight to your
              business email, so you never miss a customer.
            </Feature>
            <Feature title="Edit it yourself, no code" icon={PencilSimple} pink delay={240}>
              Click any text or image to change it. Update prices, hours, or
              photos in seconds, whenever you like.
            </Feature>
            <Feature title="Fast and mobile ready" icon={Lightning} delay={320}>
              Built to load fast and look sharp on every phone, where most of
              your customers will actually see it.
            </Feature>
            <Feature title="Yours to keep" icon={ShieldCheck} pink delay={400}>
              No monthly lock in and no platform that holds your site hostage.
              What we build belongs to you.
            </Feature>
          </div>
        </div>
      </section>

      {/* ── Mobile (phone frame) + Google (search frame) ── */}
      <section className="scroll-mt-24 border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)]">
        <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <Reveal className="max-w-2xl">
            <Eyebrow>Made to be seen, and found</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              Looks the part on every screen, and shows up on Google.
            </h2>
            <p className="mt-4 text-lg text-[color:var(--lp-muted)]">
              Most of your customers find you on a phone, after a quick search. We
              build for both from day one, and for speed too.
            </p>
          </Reveal>
          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            {/* phone */}
            <Reveal className="flex flex-col items-center gap-5">
              <PhoneFrame>
                <Screen
                  kind="image"
                  title="On a phone"
                  hint="Tall portrait screenshot"
                  tip="A real phone screenshot of a finished site, tall portrait at about 9:18 (a full phone screen, roughly 1080x2160). Capture the hero so it clearly reads as the same site on mobile. A clean device render works just as well as a real screen grab."
                  badgeClassName="left-3 top-8"
                />
              </PhoneFrame>
              <div className="flex items-center gap-2 text-sm text-[color:var(--lp-muted)]">
                <DeviceMobile className="h-4 w-4 text-[color:var(--brand-accent)]" weight="duotone" />
                Flawless on every device
              </div>
            </Reveal>
            {/* google */}
            <Reveal delay={120} className="flex flex-col gap-5 lg:pt-4">
              <BrowserFrame url="google.com/search" screenClassName="aspect-[4/3]">
                <Screen
                  kind="image"
                  title="Found on Google"
                  hint="Local search results"
                  tip="A screenshot of a real Google results page where the business ranks for a local search like 'electrician in [town]'. Crop to the top results and highlight theirs. A before and after (not found, then page one) is even stronger."
                />
              </BrowserFrame>
              <div className="flex items-center gap-2 text-sm text-[color:var(--lp-muted)]">
                <MagnifyingGlass className="h-4 w-4 text-[color:var(--brand-accent)]" weight="bold" />
                Built to climb local search
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── SEO offering (we set it up, you stay in control) ── */}
      <section className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>Search, handled</Eyebrow>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
              Built to rank, and yours to fine-tune.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[color:var(--lp-muted)]">
              Getting found on Google is built in, not sold back to you later. We
              lay the SEO groundwork on every page, then hand you the controls so
              you can keep it sharp as your business grows.
            </p>
            <button
              onClick={scrollToProposal}
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[color-mix(in_oklab,var(--brand)_35%,transparent)] transition-transform hover:scale-[1.02]"
            >
              Get found on Google
              <ArrowRight className="h-4 w-4" />
            </button>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] p-8">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--brand)_24%,var(--lp-card))] text-[color:var(--brand-accent)]">
                  <MagnifyingGlass className="h-5 w-5" weight="duotone" />
                </span>
                <p className="text-sm font-semibold uppercase tracking-wider text-[color:var(--lp-muted)]">
                  What we set up
                </p>
              </div>
              <ul className="mt-5 space-y-3.5">
                {[
                  "Clean, fast code that search engines reward",
                  "A clear title and description on every page",
                  "Local SEO so nearby customers find you first",
                  "Mobile-first, the way Google ranks today",
                  "Submitted to Google so you start showing up",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[color:var(--lp-text)]">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-accent)_24%,var(--lp-card))] text-[color:var(--brand-accent)]">
                      <Check className="h-3 w-3" weight="bold" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-6 border-t border-[color:var(--lp-line)] pt-6">
                <p className="text-sm font-semibold uppercase tracking-wider text-[color:var(--lp-muted)]">
                  And you stay in control
                </p>
                <ul className="mt-4 space-y-3.5">
                  {[
                    "Edit your own page titles and descriptions anytime",
                    "Tune the words customers search for, no developer needed",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-[color:var(--lp-text)]">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand)_24%,var(--lp-card))] text-[color:var(--brand)]">
                        <Check className="h-3 w-3" weight="bold" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Why us / advantages (brand overview video) ── */}
      <section className="relative scroll-mt-24 overflow-hidden">
        <div className={styles.aurora} style={{ width: 420, height: 420, bottom: -170, left: -150, opacity: 0.24 }} />
        <div className="relative mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            {/* brand overview video */}
            <Reveal className="relative">
              <OrbitRings className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 opacity-40 lg:block" />
              <div className="relative aspect-video overflow-hidden rounded-2xl border border-[color:var(--lp-line2)] bg-[color:var(--lp-card2)] shadow-2xl">
                <Screen
                  kind="video"
                  title="Who you are working with"
                  hint="Short brand overview"
                  tip="A short, upbeat overview of working with us: who we are, a few seconds of real builds, and the big advantages (fast turnaround, one fair fixed price, you own everything, edit it yourself). 30 to 60 seconds, 16:9, voiceover or captions. Keep it about us and the value, not a single client."
                />
              </div>
            </Reveal>
            {/* copy */}
            <Reveal delay={120}>
              <Eyebrow>Why work with us</Eyebrow>
              <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
                A professional team, without the heavy price tag.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-[color:var(--lp-muted)]">
                You get the polish of a proper studio with none of the runaround.
                One point of contact, a fast turnaround, and a website you fully
                own at the end.
              </p>
              <ul className="mt-7 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[
                  "One fair, fixed price",
                  "Live in days, not months",
                  "You own it, domain and all",
                  "Edit it yourself, anytime",
                ].map((b) => (
                  <li key={b} className="flex items-center gap-3 text-[15px] font-medium text-[color:var(--lp-text)]">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-accent)_22%,var(--lp-card))] text-[color:var(--brand-accent)]">
                      <Check className="h-3.5 w-3.5" weight="bold" />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="scroll-mt-24 border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)]">
        <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <Eyebrow>Simple, honest pricing</Eyebrow>
              <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
                One clear price. Quoted free, up front.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-[color:var(--lp-muted)]">
                Every business is different, so every quote is custom, and free.
                Tell us what you need and we send a fixed price with no surprises,
                no hourly meter, and no guessing games.
              </p>
              <button onClick={scrollToProposal} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[color-mix(in_oklab,var(--brand)_35%,transparent)] transition-transform hover:scale-[1.02]">
                Get my free quote
                <ArrowRight className="h-4 w-4" />
              </button>
            </Reveal>
            <Reveal delay={120}>
              <div className="rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] p-8">
                <p className="text-sm font-semibold uppercase tracking-wider text-[color:var(--lp-muted)]">
                  Everything is included
                </p>
                <ul className="mt-5 space-y-3.5">
                  {[
                    "A website designed around your business",
                    "Your own domain, hosting and SSL",
                    "Contact form wired to your inbox",
                    "Self serve editor, change it anytime",
                    "Mobile ready and built for speed",
                    "One fixed price, no monthly fees",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-[color:var(--lp-text)]">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-accent)_24%,var(--lp-card))] text-[color:var(--brand-accent)]">
                        <Check className="h-3 w-3" weight="bold" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 py-20 lg:py-28">
        <Reveal className="text-center">
          <div className="flex justify-center"><Eyebrow>Questions</Eyebrow></div>
          <h2 className="mt-5 text-3xl font-black tracking-tight text-[color:var(--lp-text)] sm:text-4xl">
            Good questions, straight answers.
          </h2>
        </Reveal>
        <Reveal delay={120} className="mt-10">
          <Faq q="How long does it take?" a="Most sites go live within a few days of agreeing the plan. Bigger sites take a little longer, and we tell you exactly when in your proposal." />
          <Faq q="Do I own the website and domain?" a="Yes. It is launched on your own domain and the site is yours to keep. There is no platform you are tied to and nothing held hostage." />
          <Faq q="Can I edit it myself afterwards?" a="Absolutely. You click any text or image right on your live site to change it. No code, no clunky dashboard. Update prices, hours, and photos in seconds." />
          <Faq q="What does it cost?" a="One fixed, up front price tailored to what you need, quoted free before you commit. No hourly billing and no monthly lock in." />
          <Faq q="I already have a website. Can you help?" a="Often, yes. We rebuild it properly or move it onto something faster and easier to manage. Mention it in your request and we take a look." />
        </Reveal>
        <Reveal delay={200} className="mt-12 text-center">
          <button onClick={scrollToProposal} className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[color-mix(in_oklab,var(--brand)_35%,transparent)] transition-transform hover:scale-[1.02]">
            Get your free proposal
            <ArrowRight className="h-4 w-4" />
          </button>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[color:var(--lp-line)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 py-10 sm:flex-row">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <Brand wordmarkClassName="text-[color:var(--lp-text)]" />
            <p className="text-xs text-[color:var(--lp-muted)]">
              Websites for small businesses &amp; entrepreneurs.
            </p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-[color:var(--lp-muted)]">
            <a href="#how" className="transition-colors hover:text-[color:var(--lp-text)]">How it works</a>
            <a href="#features" className="transition-colors hover:text-[color:var(--lp-text)]">What you get</a>
            <a href="#pricing" className="transition-colors hover:text-[color:var(--lp-text)]">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-[color:var(--lp-text)]">FAQ</a>
          </nav>
        </div>
        <div className="border-t border-[color:var(--lp-line)] py-5">
          <p className="text-center text-xs text-[color:var(--lp-muted)]">
            © {new Date().getFullYear()} · Websites that work as hard as you do.
          </p>
        </div>
      </footer>

      <ScrollToggle />
    </div>
  );
}
