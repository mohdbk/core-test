import { Camera, Plus, Video, VideoOff } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCameras } from "../hooks/useCameras.js";
import AddCameraDialog from "./AddCameraDialog.jsx";

// Persistent left rail of cameras. Replaces the dropdown switcher as the
// primary selection surface — always visible, supports many cameras.
export default function CameraList() {
  const { cameras, refresh } = useCameras();
  const { cameraId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const [showAdd, setShowAdd] = useState(false);

  const viewPrefix = loc.pathname.startsWith("/config") ? "/config" : "/stream";
  const goto = (id) => nav(`${viewPrefix}/${id}`);

  return (
    <aside className="w-[220px] shrink-0 flex flex-col border-r border-white/[.04] bg-surface/40 backdrop-blur-xl">
      <header className="px-3 pt-3 pb-1 flex items-center gap-2">
        <h2 className="label flex items-center gap-1.5">
          <Camera size={11} strokeWidth={2} className="text-subtle/60" />
          Cameras
        </h2>
        <span className="pill ml-auto">{cameras.length}</span>
      </header>

      <div className="flex-1 overflow-auto px-2 pt-2 pb-2 space-y-1">
        {cameras.length === 0 && (
          <div className="text-subtle/80 text-[12px] px-2 py-3 leading-snug">
            No cameras yet. Add one to start.
          </div>
        )}
        {cameras.map((c) => (
          <button
            key={c.id}
            onClick={() => goto(c.id)}
            className={[
              "w-full text-left p-2 rounded-lg transition-colors flex items-start gap-2.5 group",
              c.id === cameraId
                ? "bg-cyan-400/[.08] shadow-[inset_0_0_0_1px_rgba(34,211,238,.30)]"
                : "hover:bg-white/[.04] border border-transparent",
            ].join(" ")}
            title={c.id}
          >
            <div
              className={[
                "w-7 h-7 grid place-items-center rounded-md shrink-0 transition-colors",
                c.enabled !== false
                  ? "bg-cyan-400/10 border border-cyan-400/30 text-cyan-400"
                  : "bg-white/[.03] border border-white/[.07] text-muted",
              ].join(" ")}
            >
              {c.enabled !== false
                ? <Video size={13} strokeWidth={1.75} />
                : <VideoOff size={13} strokeWidth={1.75} />}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-[13px] truncate text-text">{c.name}</div>
              <div className="font-mono text-[10px] text-subtle truncate mt-0.5 tabular-nums">
                {c.zone_count ?? 0} zones · {c.detector_count ?? 0} det · {c.rule_count ?? 0} rules
              </div>
            </div>
          </button>
        ))}
      </div>

      <footer className="p-2 border-t border-white/5">
        <button onClick={() => setShowAdd(true)} className="btn-primary w-full">
          <Plus size={12} strokeWidth={2.25} />
          New camera
        </button>
      </footer>

      {showAdd && (
        <AddCameraDialog
          onClose={() => setShowAdd(false)}
          onCreated={(cam) => { setShowAdd(false); refresh(); goto(cam.id); }}
        />
      )}
    </aside>
  );
}
