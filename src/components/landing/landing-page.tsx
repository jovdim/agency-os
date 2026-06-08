"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";
import { HeroVisual } from "./hero-visual";
import { DiscoveryVisual, OrbitRings } from "./landing-visuals";
import { LeadForm } from "./lead-form";
import styles from "./landing.module.css";
import {
  ArrowRight,
  CaretDown,
  Check,
  DeviceMobile,
  Envelope,
  GlobeHemisphereWest,
  Lightning,
  MagicWand,
  PaperPlaneTilt,
  PencilSimple,
  Rocket,
  ShieldCheck,
  Sparkle,
  Storefront,
} from "@phosphor-icons/react/ssr";

function scrollToProposal() {
  document.getElementById("proposal")?.scrollIntoView({ behavior: "smooth" });
}

type Icon = React.ComponentType<{ className?: string; weight?: "duotone" | "fill" | "bold" }>;

/* ── Small building blocks ─────────────────────────────────────────────── */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--lp-muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brand-accent)]" />
      {children}
    </span>
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
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--lp-muted)]">{a}</p>
    </details>
  );
}

const SECTORS = ["Cafés", "Salons", "Trades", "Clinics", "Studios", "Shops", "Trainers", "Law firms"];

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
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="Home">
            <Brand wordmarkClassName="text-[color:var(--lp-text)]" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-[color:var(--lp-muted)] md:flex">
            <a href="#how" className="transition-colors hover:text-[color:var(--lp-text)]">How it works</a>
            <a href="#features" className="transition-colors hover:text-[color:var(--lp-text)]">What you get</a>
            <a href="#pricing" className="transition-colors hover:text-[color:var(--lp-text)]">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-[color:var(--lp-text)]">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)] sm:inline-flex"
            >
              Sign in
            </Link>
            <Button onClick={scrollToProposal} className="gap-1.5">
              Get a free proposal
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className={styles.aurora} style={{ width: 480, height: 480, top: -170, left: -120 }} />
        <div className={styles.aurora} style={{ width: 420, height: 420, top: 30, right: -150, animationDelay: "3s", opacity: 0.38 }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <div>
            <Reveal><Eyebrow>Websites for small businesses &amp; entrepreneurs</Eyebrow></Reveal>
            <Reveal delay={80}>
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
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--lp-muted)]">
                We design, build, and launch a fast, modern website for your
                business, on your own domain. Then we hand you a dead simple way
                to edit it yourself. One service, done properly. No jargon, no
                page builders, no monthly lock in.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button onClick={scrollToProposal} className={`${styles.sheen} relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-[color:var(--brand)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[color-mix(in_oklab,var(--brand)_45%,transparent)] transition-transform hover:scale-[1.02] active:scale-100`}>
                  <PaperPlaneTilt className="h-4 w-4" weight="fill" />
                  Get my free proposal
                </button>
                <a href="#how" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--lp-line2)] px-6 py-3.5 text-sm font-semibold text-[color:var(--lp-text)] transition-colors hover:bg-white/5">
                  See how it works
                  <CaretDown className="h-4 w-4" />
                </a>
              </div>
            </Reveal>
            <Reveal delay={320}>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[color:var(--lp-muted)]">
                <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-[color:var(--brand-accent)]" weight="bold" /> Live in days</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-[color:var(--brand-accent)]" weight="bold" /> You own everything</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-[color:var(--brand-accent)]" weight="bold" /> Edit it yourself</span>
              </div>
            </Reveal>
          </div>

          <Reveal delay={180} className="relative">
            <OrbitRings className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 opacity-50" />
            <div className={`relative ${styles.drift}`}>
              <HeroVisual className="mx-auto w-full max-w-md drop-shadow-2xl" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Sectors (static, calm) ── */}
      <section className="border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)]">
        <div className="mx-auto max-w-5xl px-5 py-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--lp-muted)]">
            Built for local businesses of every kind
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {SECTORS.map((s) => (
              <span key={s} className="rounded-full border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] px-3.5 py-1.5 text-sm text-[color:var(--lp-text)]">
                {s}
              </span>
            ))}
          </div>
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
      <section id="how" className="scroll-mt-20 border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)]">
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
            {/* connector with a glow that travels along it (desktop) */}
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
                We start from designs proven to convert and tailor them around
                your brand, your words, and your customers.
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

      {/* ── Features ── */}
      <section id="features" className="relative scroll-mt-20 overflow-hidden">
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
              Click any text or image to change it, like magic. Update prices,
              hours, or photos in seconds, whenever you like.
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

      {/* ── Pricing ── */}
      <section id="pricing" className="scroll-mt-20 border-y border-[color:var(--lp-line)] bg-[color:var(--lp-bg2)]">
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
      <section id="faq" className="scroll-mt-20 mx-auto max-w-3xl px-5 py-20 lg:py-28">
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
      </section>

      {/* ── Final CTA + lead form ── */}
      <section id="proposal" className="scroll-mt-20 relative overflow-hidden bg-[color:var(--lp-bg2)]">
        <div className={styles.aurora} style={{ width: 460, height: 460, bottom: -200, left: "32%", opacity: 0.4 }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <Eyebrow>Get started</Eyebrow>
            <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight text-[color:var(--lp-text)] sm:text-4xl lg:text-5xl">
              Get your free proposal.
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-[color:var(--lp-muted)]">
              Tell us a little about your business. We send back a tailored plan
              and a fixed price for your website within one business day, with
              zero obligation.
            </p>
            <div className="mt-8 flex items-center gap-3 text-sm text-[color:var(--lp-muted)]">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-[color:var(--brand-accent)]">
                <DeviceMobile className="h-4 w-4" weight="duotone" />
              </span>
              Prefer to talk? Say so in your message and we call you.
            </div>
          </div>
          <div className="rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-card)] p-6 shadow-2xl sm:p-8">
            <LeadForm />
          </div>
        </div>
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
            <Link href="/login" className="transition-colors hover:text-[color:var(--lp-text)]">Sign in</Link>
          </nav>
        </div>
        <div className="border-t border-[color:var(--lp-line)] py-5">
          <p className="text-center text-xs text-[color:var(--lp-muted)]">
            © {new Date().getFullYear()} · Websites that work as hard as you do.
          </p>
        </div>
      </footer>
    </div>
  );
}
