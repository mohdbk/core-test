import {
  AlertCircle, AlertTriangle, CheckCircle2, Loader2, WifiOff,
} from "lucide-react";

// Unified status indicator. Pick a `tone` and an optional icon override.
// Used by save status, engine connection, etc.
const TONES = {
  ok:       { bg: "bg-emerald-500/10",  border: "border-emerald-500/30",  fg: "text-emerald-400", Icon: CheckCircle2 },
  pending:  { bg: "bg-amber-500/10",    border: "border-amber-500/30",    fg: "text-amber-400",   Icon: Loader2 },
  loading:  { bg: "bg-white/[.04]",     border: "border-white/10",        fg: "text-subtle",      Icon: Loader2 },
  warn:     { bg: "bg-amber-500/10",    border: "border-amber-500/30",    fg: "text-amber-400",   Icon: AlertTriangle },
  error:    { bg: "bg-rose-500/10",     border: "border-rose-500/30",     fg: "text-rose-400",    Icon: AlertCircle },
  offline:  { bg: "bg-rose-500/10",     border: "border-rose-500/30",     fg: "text-rose-400",    Icon: WifiOff },
  accent:   { bg: "bg-cyan-400/10",     border: "border-cyan-400/30",     fg: "text-cyan-400",    Icon: CheckCircle2 },
  neutral:  { bg: "bg-white/[.04]",     border: "border-white/10",        fg: "text-subtle",      Icon: null },
};

export default function StatusBadge({ tone = "neutral", label, icon: IconOverride, spin = false }) {
  const t = TONES[tone] || TONES.neutral;
  const Icon = IconOverride || t.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md
                  text-[11px] font-medium border ${t.bg} ${t.border} ${t.fg}`}
    >
      {Icon && <Icon size={12} strokeWidth={2} className={spin ? "animate-spin" : ""} />}
      {label}
    </span>
  );
}
