import styles from "./landing.module.css";

/**
 * The hero's signature visual: a browser window that draws its own frame, then
 * pops its content into place block-by-block while a cursor clicks around —
 * "a website, building itself". Pure SVG + CSS keyframes, no JS. Deliberately
 * hand-built (not a stock illustration) so it reads as ours, not AI filler.
 */
export function HeroVisual({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 196"
      className={className}
      fill="none"
      role="img"
      aria-label="A website assembling itself inside a browser window"
    >
      {/* Orbiting decorations */}
      <circle
        className={styles.spin}
        cx="194"
        cy="40"
        r="15"
        stroke="var(--brand-accent)"
        strokeWidth="1.5"
        strokeDasharray="3 7"
        strokeOpacity="0.8"
      />
      <circle className={styles.pulse} cx="22" cy="150" r="4" fill="var(--brand-accent)" />
      <circle className={styles.drift} cx="206" cy="120" r="3" fill="var(--brand)" />
      <path
        className={styles.driftSlow}
        d="M188 168c6-6 12 6 18 0"
        stroke="var(--brand)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />

      {/* Browser frame (draws itself) */}
      <rect
        x="24"
        y="24"
        width="172"
        height="144"
        rx="13"
        fill="#fff"
        fillOpacity="0.04"
      />
      <rect
        className={styles.frame}
        x="24"
        y="24"
        width="172"
        height="144"
        rx="13"
        pathLength={1100}
        stroke="#fff"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      {/* title-bar separator */}
      <line x1="24" y1="42" x2="196" y2="42" stroke="#fff" strokeOpacity="0.14" strokeWidth="1" />
      {/* traffic-light dots */}
      <circle cx="36" cy="33" r="2.4" fill="var(--brand)" />
      <circle cx="45" cy="33" r="2.4" fill="var(--brand-accent)" />
      <circle cx="54" cy="33" r="2.4" fill="#fff" fillOpacity="0.3" />
      {/* fake url pill */}
      <rect x="74" y="29" width="108" height="8" rx="4" fill="#fff" fillOpacity="0.08" />

      {/* Content blocks pop in, staggered */}
      <g>
        <rect className={styles.block} style={{ animationDelay: "1.6s" }} x="36" y="52" width="60" height="7" rx="3" fill="#fff" fillOpacity="0.28" />
        <rect className={styles.block} style={{ animationDelay: "1.75s" }} x="150" y="52" width="36" height="7" rx="3.5" fill="var(--brand)" fillOpacity="0.75" />
        <rect className={styles.block} style={{ animationDelay: "1.95s" }} x="36" y="68" width="86" height="30" rx="5" fill="var(--brand)" fillOpacity="0.85" />
        <rect className={styles.block} style={{ animationDelay: "2.1s" }} x="130" y="68" width="56" height="30" rx="5" fill="var(--brand-accent)" fillOpacity="0.55" />
        <rect className={styles.block} style={{ animationDelay: "2.32s" }} x="36" y="106" width="112" height="5" rx="2.5" fill="#fff" fillOpacity="0.22" />
        <rect className={styles.block} style={{ animationDelay: "2.42s" }} x="36" y="115" width="84" height="5" rx="2.5" fill="#fff" fillOpacity="0.16" />
        <rect className={styles.block} style={{ animationDelay: "2.56s" }} x="36" y="128" width="48" height="14" rx="7" fill="var(--brand-accent)" />
        <rect className={styles.block} style={{ animationDelay: "2.66s" }} x="92" y="128" width="34" height="14" rx="7" fill="#fff" fillOpacity="0.12" />
      </g>

      {/* Clicking cursor */}
      <g className={styles.cursor} style={{ animationDelay: "2.4s" }}>
        <path
          d="M0 0 L0 15 L4.2 11 L7.2 17 L9.4 16 L6.4 10 L11.4 10 Z"
          fill="#fff"
          stroke="oklch(0.2 0.02 285)"
          strokeWidth="0.8"
        />
      </g>
    </svg>
  );
}
