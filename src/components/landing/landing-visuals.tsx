import styles from "./landing.module.css";

/**
 * Discovery radar — a storefront pin with ripple rings pinging outward and
 * customer dots orbiting in. "People finding your business online."
 */
export function DiscoveryVisual({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" className={className} fill="none" role="img" aria-label="Customers discovering your business online">
      {[0, 1, 2].map((i) => (
        <circle key={i} className={styles.ripple} style={{ animationDelay: `${i * 1.13}s` }} cx="120" cy="120" r="62" stroke="var(--brand)" strokeWidth="1.5" strokeOpacity="0.55" />
      ))}
      <g className={styles.spin} style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}>
        <circle cx="120" cy="120" r="95" stroke="var(--lp-line2)" strokeWidth="1" strokeDasharray="2 9" />
        <circle cx="120" cy="25" r="5" fill="var(--brand-accent)" />
        <circle cx="215" cy="120" r="3.5" fill="var(--brand)" />
        <circle cx="120" cy="215" r="4.5" fill="var(--brand-accent)" fillOpacity="0.85" />
        <circle cx="25" cy="120" r="3" fill="#fff" fillOpacity="0.55" />
      </g>
      <circle className={styles.glow} cx="120" cy="120" r="44" fill="var(--brand)" fillOpacity="0.15" />
      <circle cx="120" cy="120" r="30" fill="var(--lp-card2)" stroke="var(--lp-line2)" />
      <path d="M120 100a15 15 0 0 0-15 15c0 10.5 15 24 15 24s15-13.5 15-24a15 15 0 0 0-15-15Z" fill="var(--brand-accent)" />
      <circle cx="120" cy="115" r="5" fill="#fff" />
    </svg>
  );
}

/**
 * Multi-ring orbit system: three concentric dashed rings counter-rotating at
 * different speeds, each carrying a glowing satellite. Premium ambient motion.
 */
export function OrbitRings({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} fill="none" aria-hidden>
      <g className={styles.spin} style={{ transformBox: "view-box", transformOrigin: "100px 100px" }}>
        <circle cx="100" cy="100" r="92" stroke="var(--brand)" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="3 9" />
        <circle className={styles.glow} cx="100" cy="8" r="9" fill="var(--brand-accent)" fillOpacity="0.4" />
        <circle cx="100" cy="8" r="4.5" fill="var(--brand-accent)" />
      </g>
      <g className={styles.spinRev} style={{ transformBox: "view-box", transformOrigin: "100px 100px" }}>
        <circle cx="100" cy="100" r="70" stroke="var(--brand-accent)" strokeOpacity="0.26" strokeWidth="1" strokeDasharray="2 10" />
        <circle className={styles.glow} cx="170" cy="100" r="7" fill="var(--brand)" fillOpacity="0.4" />
        <circle cx="170" cy="100" r="3.5" fill="var(--brand)" />
      </g>
      <g className={styles.spinSlow} style={{ transformBox: "view-box", transformOrigin: "100px 100px" }}>
        <circle cx="100" cy="100" r="50" stroke="var(--brand)" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="1 11" />
        <circle cx="100" cy="150" r="3" fill="var(--brand-accent)" />
      </g>
    </svg>
  );
}

/* A drifting network of nodes + faint connecting lines (constellation). */
const NODES = [
  { x: 40, y: 58, r: 3 }, { x: 112, y: 38, r: 2.4 }, { x: 182, y: 70, r: 3.4 },
  { x: 252, y: 50, r: 2.6 }, { x: 284, y: 124, r: 3 }, { x: 222, y: 162, r: 2.4 },
  { x: 150, y: 138, r: 3.6 }, { x: 80, y: 150, r: 2.6 }, { x: 42, y: 214, r: 3 },
  { x: 124, y: 244, r: 2.4 }, { x: 210, y: 252, r: 3.2 }, { x: 274, y: 208, r: 2.6 },
];
const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
  [6, 2], [1, 7], [5, 11], [10, 11], [9, 10], [8, 9], [6, 10], [2, 4],
];

export function Constellation({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 320" className={className} fill="none" aria-hidden>
      <g className={styles.driftSlow}>
        {LINKS.map(([a, b], i) => (
          <line
            key={i}
            className={styles.netLine}
            style={{ animationDelay: `${i * 0.4}s` }}
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
            stroke={i % 2 ? "var(--brand-accent)" : "var(--brand)"}
            strokeWidth="1"
          />
        ))}
        {NODES.map((n, i) => (
          <circle
            key={`${n.x}-${n.y}`}
            className={i % 2 ? styles.glow : styles.twinkle}
            style={{ animationDelay: `${i * 0.5}s`, transformBox: "view-box", transformOrigin: `${n.x}px ${n.y}px` }}
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={i % 3 ? "var(--brand-accent)" : "var(--brand)"}
          />
        ))}
      </g>
    </svg>
  );
}
