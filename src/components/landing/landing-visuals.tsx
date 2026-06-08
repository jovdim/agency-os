import styles from "./landing.module.css";

/**
 * Discovery radar — a storefront pin with ripple rings pinging outward and
 * customer dots orbiting in. Reads as "people finding your business online".
 * Ambient loop (slow), so it looks right whenever it scrolls into view.
 */
export function DiscoveryVisual({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 240"
      className={className}
      fill="none"
      role="img"
      aria-label="Customers discovering your business online"
    >
      {/* ping rings */}
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          className={styles.ripple}
          style={{ animationDelay: `${i * 1.13}s` }}
          cx="120"
          cy="120"
          r="62"
          stroke="var(--brand)"
          strokeWidth="1.5"
          strokeOpacity="0.55"
        />
      ))}

      {/* orbit of incoming customers */}
      <g className={styles.spin} style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}>
        <circle cx="120" cy="120" r="95" stroke="var(--lp-line2)" strokeWidth="1" strokeDasharray="2 9" />
        <circle cx="120" cy="25" r="5" fill="var(--brand-accent)" />
        <circle cx="215" cy="120" r="3.5" fill="var(--brand)" />
        <circle cx="120" cy="215" r="4.5" fill="var(--brand-accent)" fillOpacity="0.85" />
        <circle cx="25" cy="120" r="3" fill="#fff" fillOpacity="0.55" />
      </g>

      {/* glow + hub */}
      <circle className={styles.glow} cx="120" cy="120" r="44" fill="var(--brand)" fillOpacity="0.15" />
      <circle cx="120" cy="120" r="30" fill="var(--lp-card2)" stroke="var(--lp-line2)" />
      {/* pin */}
      <path
        d="M120 100a15 15 0 0 0-15 15c0 10.5 15 24 15 24s15-13.5 15-24a15 15 0 0 0-15-15Z"
        fill="var(--brand-accent)"
      />
      <circle cx="120" cy="115" r="5" fill="#fff" />
    </svg>
  );
}

/**
 * Decorative counter-rotating dashed rings. A quiet, premium accent behind a
 * heading or visual — pure ambient motion.
 */
export function OrbitRings({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} fill="none" aria-hidden>
      <g className={styles.spin} style={{ transformBox: "view-box", transformOrigin: "80px 80px" }}>
        <circle cx="80" cy="80" r="72" stroke="var(--brand)" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="3 8" />
        <circle cx="80" cy="8" r="3" fill="var(--brand-accent)" />
      </g>
      <g className={styles.spinRev} style={{ transformBox: "view-box", transformOrigin: "80px 80px" }}>
        <circle cx="80" cy="80" r="52" stroke="var(--brand-accent)" strokeOpacity="0.26" strokeWidth="1" strokeDasharray="2 10" />
        <circle cx="132" cy="80" r="2.5" fill="var(--brand)" />
      </g>
    </svg>
  );
}
