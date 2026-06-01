import Sparkline from "./Sparkline.jsx";

// Compact KPI used in the TopBar strip. Vertical: label on top, value
// below. Optional Icon, trend sparkline, and unit suffix.
export default function KPI({
  icon: Icon,
  label,
  value,
  unit,
  series,
  tone = "neutral",
  format,
}) {
  const fmt = typeof value === "number" && Number.isFinite(value)
    ? (format ? format(value) : value.toString())
    : (value ?? "—");
  const t = TONES[tone] || TONES.neutral;

  return (
    <div className="flex items-center gap-2.5 px-3 h-full whitespace-nowrap">
      {Icon && <Icon size={12} strokeWidth={1.75} className={t.fg} />}
      <div className="flex flex-col leading-none gap-[3px]">
        <span className="text-[9px] uppercase tracking-[0.16em] text-text/45 font-medium">
          {label}
        </span>
        <span className="font-mono tabular-nums text-[13px] text-text font-semibold">
          {fmt}
          {unit && <span className="text-text/45 font-normal ml-0.5">{unit}</span>}
        </span>
      </div>
      {series && series.length > 1 && (
        <div className="ml-1 opacity-90">
          <Sparkline data={series} width={42} height={16} color={t.stroke} fill={t.fill} />
        </div>
      )}
    </div>
  );
}

const TONES = {
  live:    { fg: "text-cyan-300",    stroke: "#22d3ee", fill: "rgba(34,211,238,.22)" },
  alert:   { fg: "text-rose-300",    stroke: "#fb7185", fill: "rgba(251,113,133,.22)" },
  warn:    { fg: "text-amber-300",   stroke: "#fbbf24", fill: "rgba(251,191,36,.22)" },
  ok:      { fg: "text-emerald-300", stroke: "#34d399", fill: "rgba(52,211,153,.22)" },
  info:    { fg: "text-violet-300",  stroke: "#a78bfa", fill: "rgba(167,139,250,.22)" },
  neutral: { fg: "text-text/55",     stroke: "#7a8294", fill: "rgba(122,130,148,.15)" },
};
