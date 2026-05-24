import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useState } from "react";

// Collapsible disclosure for low-priority but useful fields (camera id, source
// URL, resolution, etc.). Default closed so the parent card stays scannable.
export default function MetadataBlock({ items, defaultOpen = false, label = "Metadata" }) {
  const [open, setOpen] = useState(defaultOpen);
  const filtered = items.filter((it) => it.value !== undefined && it.value !== null && it.value !== "");
  if (filtered.length === 0) return null;

  return (
    <div className="rounded-md border border-white/[.06] bg-black/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 h-7 text-left hover:bg-white/[.03] transition-colors"
      >
        {open
          ? <ChevronDown size={11} strokeWidth={2} className="text-subtle/70" />
          : <ChevronRight size={11} strokeWidth={2} className="text-subtle/70" />}
        <Info size={11} strokeWidth={1.75} className="text-subtle/50" />
        <span className="label">{label}</span>
        <span className="ml-auto text-subtle/50 text-[10px] font-mono tabular-nums">{filtered.length}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 pt-1.5 space-y-1.5 border-t border-white/[.05]">
          {filtered.map((it, i) => (
            <div key={i} className="grid grid-cols-[68px_minmax(0,1fr)] gap-2 text-[11px] items-start">
              <span className="label normal-case tracking-normal text-subtle/80 font-normal pt-0.5">{it.key}</span>
              <div className="min-w-0 break-words">{it.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
