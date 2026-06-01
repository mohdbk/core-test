import { Camera, Plus, Video, VideoOff } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCameras } from "../hooks/useCameras.js";
import AddCameraDialog from "./AddCameraDialog.jsx";
import Card from "./Card.jsx";
import EmptyState from "./EmptyState.jsx";
import StatusDot from "./StatusDot.jsx";

// Left column on the Operations Console. Always-visible camera roster with
// add-camera affordance. Selection drives the route; the rest of the shell
// reacts via :cameraId.
export default function CameraList() {
  const { cameras, refresh } = useCameras();
  const { cameraId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const [showAdd, setShowAdd] = useState(false);

  const viewPrefix = loc.pathname.startsWith("/config") ? "/config" : "/console";
  const goto = (id) => nav(`${viewPrefix}/${id}`);

  return (
    <Card
      icon={Camera}
      title="Cameras"
      count={cameras.length}
      right={
        <button
          onClick={() => setShowAdd(true)}
          title="Add camera"
          className="grid place-items-center w-5 h-5 rounded text-text/55 hover:text-cyan-300 hover:bg-white/[.04] transition-colors"
        >
          <Plus size={12} strokeWidth={2.25} />
        </button>
      }
      className="h-full min-h-0"
      bodyClassName="p-1.5 overflow-y-auto"
    >
      {cameras.length === 0 ? (
        <EmptyState
          icon={Video}
          title="No cameras"
          hint="Add a camera to start monitoring."
          action={
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={12} strokeWidth={2.25} /> Add camera
            </button>
          }
        />
      ) : (
        <div className="space-y-1">
          {cameras.map((c) => {
            const selected = c.id === cameraId;
            const live = c.enabled !== false;
            return (
              <button
                key={c.id}
                onClick={() => goto(c.id)}
                title={c.id}
                className={[
                  "w-full text-left p-2 rounded-md flex items-center gap-2 group transition-colors",
                  selected
                    ? "bg-cyan-400/[.08] border border-cyan-400/30 shadow-[inset_0_0_0_1px_rgba(34,211,238,.20)]"
                    : "border border-white/[.04] hover:border-white/[.10] hover:bg-white/[.02]",
                ].join(" ")}
              >
                <div
                  className={[
                    "grid place-items-center w-7 h-7 rounded shrink-0 border",
                    live
                      ? "bg-cyan-400/[.08] border-cyan-400/30 text-cyan-300"
                      : "bg-white/[.02] border-white/[.06] text-text/45",
                  ].join(" ")}
                >
                  {live ? <Video size={13} strokeWidth={1.75} /> : <VideoOff size={13} strokeWidth={1.75} />}
                </div>
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="text-[13px] text-text truncate">{c.name}</div>
                  <div className="font-mono text-[10px] text-text/50 truncate mt-0.5 tabular-nums">
                    {c.zone_count ?? 0} zones · {c.detector_count ?? 0} det · {c.rule_count ?? 0} rules
                  </div>
                </div>
                {live && <StatusDot tone="live" pulse size={6} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddCameraDialog
          onClose={() => setShowAdd(false)}
          onCreated={(cam) => { setShowAdd(false); refresh(); goto(cam.id); }}
        />
      )}
    </Card>
  );
}
