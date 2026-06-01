// Tiny status dot, optionally pulsing. Used in the TopBar live indicator
// and incident rows.
export default function StatusDot({ tone = "live", pulse = false, size = 8, className = "" }) {
  const color = TONES[tone] || TONES.live;
  return (
    <span
      className={["inline-block rounded-full shrink-0", pulse ? "dot-pulse" : "", className].join(" ")}
      style={{
        width:  `${size}px`,
        height: `${size}px`,
        backgroundColor: color,
        boxShadow: pulse ? `0 0 0 2px ${color}28` : undefined,
      }}
    />
  );
}

const TONES = {
  live:    "#22d3ee",
  alert:   "#fb7185",
  warn:    "#fbbf24",
  ok:      "#34d399",
  info:    "#a78bfa",
  neutral: "#5b6478",
};
