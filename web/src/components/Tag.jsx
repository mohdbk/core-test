// Small status / severity tag. Uppercase + tight tracking. Semantic colors
// map to the system palette so the same tone reads the same everywhere.
//
//   <Tag tone="alert">trip_fall</Tag>
//   <Tag tone="live" icon={Radio}>live</Tag>
export default function Tag({ tone = "neutral", icon: Icon, children, className = "" }) {
  const cls = TONES[tone] || TONES.neutral;
  return (
    <span className={["tag", cls, className].join(" ")}>
      {Icon && <Icon size={9} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

const TONES = {
  live:    "tag-live",
  alert:   "tag-alert",
  warn:    "tag-warn",
  ok:      "tag-ok",
  info:    "tag-info",
  neutral: "tag-neutral",
};
