import AnimatedNumber from "./AnimatedNumber.jsx";
import Sparkline from "./Sparkline.jsx";

// A single metric in the context bar. `value` is the current number, `series`
// is optional history for the inline sparkline. `tone` drives accent color.
const TONES = {
  cyan:    { stroke: "#22d3ee", fillFrom: "rgba(34, 211, 238, .25)",  fg: "text-cyan-400" },
  violet:  { stroke: "#a78bfa", fillFrom: "rgba(167, 139, 250, .25)", fg: "text-violet-400" },
  amber:   { stroke: "#fbbf24", fillFrom: "rgba(251, 191, 36, .25)",  fg: "text-amber-400" },
  emerald: { stroke: "#34d399", fillFrom: "rgba(52, 211, 153, .25)",  fg: "text-emerald-400" },
  rose:    { stroke: "#fb7185", fillFrom: "rgba(251, 113, 133, .25)", fg: "text-rose-400" },
  neutral: { stroke: "#94a3b8", fillFrom: "rgba(148, 163, 184, .18)", fg: "text-subtle" },
};

export default function MetricCell({
  icon: Icon, label, value, unit, series, tone = "neutral", format,
}) {
  const t = TONES[tone] || TONES.neutral;
  const isNum = typeof value === "number" && Number.isFinite(value);
  return (
    <div className="flex items-center gap-3 px-3 h-10 border-l border-white/[.05] first:border-l-0">
      {Icon && <Icon size={13} strokeWidth={1.75} className={t.fg} />}
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-[0.14em] text-subtle/70 font-medium">{label}</span>
        <span className="font-mono tabular-nums text-[13px] text-text whitespace-nowrap">
          {isNum
            ? <AnimatedNumber value={value} format={format || ((v) => v.toFixed(value < 10 ? 1 : 0))} />
            : <span>{value ?? "—"}</span>}
          {unit && <span className="text-subtle/80 ml-1 text-[11px]">{unit}</span>}
        </span>
      </div>
      {series && series.length > 1 && (
        <Sparkline
          data={series}
          width={56}
          height={20}
          stroke={t.stroke}
          fillFrom={t.fillFrom}
          fillTo="rgba(0,0,0,0)"
        />
      )}
    </div>
  );
}
