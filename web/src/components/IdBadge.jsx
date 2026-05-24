import { Check, Copy } from "lucide-react";
import { useState } from "react";
import Tooltip from "./Tooltip.jsx";

// Compact pill showing a UUID with copy-on-click.
//
//   variant="short"  →  `xxxxxxxx…`           one-line, fixed-height pill
//   variant="full"   →  full 36-char id       wraps via `break-all`, auto height
//
// The tooltip always shows the full id.
export default function IdBadge({ id, label = "ID", variant = "short", className = "" }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;

  async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  const isFull = variant === "full";

  return (
    <Tooltip label={copied ? "Copied" : `Click to copy ${label.toLowerCase()}`} side="bottom">
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={[
          "group inline-flex max-w-full rounded",
          "border border-white/10 bg-white/[.03] text-subtle",
          "hover:text-text hover:bg-white/[.06] hover:border-white/20 transition-colors",
          // Full variant wraps; short variant stays single-line.
          isFull
            ? "items-start gap-1.5 px-2 py-1"
            : "items-center gap-1.5 px-1.5 h-5",
          className,
        ].join(" ")}
      >
        {isFull ? (
          <span className="font-mono text-[11px] break-all leading-snug text-left flex-1 min-w-0">{id}</span>
        ) : (
          <span className="font-mono text-[10px] tabular-nums whitespace-nowrap">
            {String(id).split("-")[0]}
            <span className="text-subtle/50">…</span>
          </span>
        )}
        <span className={isFull ? "pt-[3px] shrink-0" : "shrink-0"}>
          {copied
            ? <Check size={10} strokeWidth={2.5} className="text-emerald-400" />
            : <Copy size={10} strokeWidth={2} className="text-subtle/60 group-hover:text-text" />}
        </span>
      </button>
    </Tooltip>
  );
}
