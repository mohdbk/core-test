import { Camera, Check, ChevronDown, Plus, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AddCameraDialog from "./AddCameraDialog.jsx";

export default function CameraSwitcher({ cameras, currentId, onSelect, onCameraAdded }) {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = cameras.find((c) => c.id === currentId);

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 h-7 px-2.5 rounded-md
                   border border-white/10 bg-white/[.04] hover:bg-white/[.08] hover:border-white/20
                   text-text text-[13px] font-medium transition-colors min-w-[180px]"
      >
        <Camera size={13} strokeWidth={1.75} className="text-subtle shrink-0" />
        <span className="truncate flex-1 text-left">{current?.name || "no camera"}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-subtle/80 shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-[360px] surface-strong rounded-xl p-1 z-30 animate-slide-up">
          <div className="px-2 pt-2 pb-1 label">Cameras</div>
          {cameras.length === 0 && (
            <div className="text-subtle text-xs px-2 py-3">No cameras yet.</div>
          )}
          {cameras.map((c) => (
            <button
              key={c.id}
              onClick={() => { onSelect(c.id); setOpen(false); }}
              className={[
                "w-full text-left px-2.5 py-2 rounded-md transition flex items-center gap-3",
                c.id === currentId
                  ? "bg-cyan-400/[.08] text-text shadow-[inset_0_0_0_1px_rgba(34,211,238,.25)]"
                  : "hover:bg-white/[.05]",
              ].join(" ")}
            >
              {c.enabled !== false ? (
                <Video size={14} strokeWidth={1.75} className="text-cyan-400 shrink-0" />
              ) : (
                <VideoOff size={14} strokeWidth={1.75} className="text-muted shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] truncate">{c.name}</div>
                <div className="font-mono text-[10px] text-subtle truncate">
                  {String(c.id).split("-")[0]}… · {c.zone_count ?? 0} zones · {c.detector_count ?? 0} det · {c.rule_count ?? 0} rules
                </div>
              </div>
              {c.id === currentId && <Check size={13} strokeWidth={2} className="text-cyan-400" />}
            </button>
          ))}
          <div className="my-1 mx-2 divider" />
          <button
            onClick={() => { setOpen(false); setShowAdd(true); }}
            className="w-full text-left px-2.5 py-2 rounded-md hover:bg-white/[.05] flex items-center gap-2 text-text"
          >
            <div className="w-5 h-5 grid place-items-center rounded bg-cyan-400/10 border border-cyan-400/30">
              <Plus size={11} strokeWidth={2.25} className="text-cyan-400" />
            </div>
            <span className="text-[13px]">Add camera</span>
          </button>
        </div>
      )}

      {showAdd && (
        <AddCameraDialog
          onClose={() => setShowAdd(false)}
          onCreated={(cam) => { setShowAdd(false); onCameraAdded?.(); onSelect(cam.id); }}
        />
      )}
    </div>
  );
}
