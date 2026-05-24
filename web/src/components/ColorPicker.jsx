import { Pipette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Curated palette — chosen so each color reads well against dark video
// without clashing with the cyan/violet UI accents.
export const ZONE_PALETTE = [
  "#22d3ee", "#06b6d4", "#60a5fa", "#a78bfa",
  "#c084fc", "#f472b6", "#fb7185", "#f59e0b",
  "#fbbf24", "#a3e635", "#34d399", "#ef4444",
];

// Click-to-open color popover. Rendered to <body> so it escapes any
// `overflow:hidden` ancestor (zones live in a scrollable side panel).
export default function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  function show() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ left: r.left - 6, top: r.bottom + 8 });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (popoverRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        title="Pick zone color"
        aria-label="Pick zone color"
        className="w-4 h-4 rounded-full ring-1 ring-white/20 hover:ring-white/45
                   transition-transform hover:scale-110 shrink-0"
        style={{ background: value || "#22d3ee" }}
      />
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 9999 }}
          className="surface-strong rounded-xl p-2.5 animate-fade-in"
        >
          <div className="label mb-1.5 px-0.5">Zone color</div>
          <div className="grid grid-cols-6 gap-1.5">
            {ZONE_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                style={{ background: c }}
                title={c}
                aria-label={`Set color ${c}`}
                className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${
                  c === value
                    ? "ring-2 ring-white shadow-[0_0_10px_rgba(255,255,255,.45)]"
                    : "ring-1 ring-white/10"
                }`}
              />
            ))}
          </div>
          <label className="mt-2.5 flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-white/[.04] transition-colors">
            <span className="relative inline-flex items-center justify-center w-5 h-5 rounded-full ring-1 ring-white/15 overflow-hidden"
                  style={{ background: value }}>
              <Pipette size={11} strokeWidth={2} className="text-white/80 mix-blend-difference" />
              <input
                type="color"
                value={value || "#22d3ee"}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </span>
            <span className="text-[11px] text-subtle">Custom…</span>
            <span className="ml-auto font-mono text-[10px] text-subtle/70 tabular-nums">
              {(value || "").toUpperCase()}
            </span>
          </label>
        </div>,
        document.body,
      )}
    </>
  );
}
