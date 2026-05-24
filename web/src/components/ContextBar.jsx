import {
  Activity, ChevronRight, Cpu, Gauge, Layers, Radio, Video, ZapOff,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { useCameras } from "../hooks/useCameras.js";
import { useEngineStatus } from "../hooks/useEngineStatus.js";
import MetricCell from "./MetricCell.jsx";

// Per-camera "session context" strip. The actual camera switcher lives in
// the left CameraList rail now — this bar just labels what's currently
// selected and shows real-time engine metrics.
export default function ContextBar() {
  const { cameraId } = useParams();
  const { cameras } = useCameras();
  const { status, fpsSeries } = useEngineStatus(cameraId);

  const current = cameras.find((c) => c.id === cameraId);

  return (
    <div className="surface rounded-xl mx-4 mt-3 mb-2 flex items-stretch overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 min-w-0">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-subtle/70 font-medium">
          <Video size={12} strokeWidth={1.75} />
          Now viewing
        </span>
        <ChevronRight size={12} className="text-subtle/40 shrink-0" />
        <span className="text-[13px] font-semibold text-text truncate max-w-[280px]">
          {current?.name || "—"}
        </span>
        {current && current.enabled === false && (
          <span className="pill text-amber-400 border-amber-500/30">disabled</span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-stretch border-l border-white/[.05]">
        <MetricCell
          icon={status?.idle ? ZapOff : Radio}
          label="status"
          value={status ? (status.idle ? `idle · ${status.idle}` : "running") : "—"}
          tone={status ? (status.idle ? "neutral" : "cyan") : "neutral"}
        />
        <MetricCell
          icon={Cpu}
          label="device"
          value={status?.device || "—"}
          tone="violet"
        />
        <MetricCell
          icon={Gauge}
          label="fps"
          value={status?.fps_actual ?? 0}
          series={fpsSeries}
          tone="cyan"
          format={(v) => v.toFixed(1)}
        />
        <MetricCell
          icon={Layers}
          label="detectors"
          value={Object.keys(status?.detectors || {}).length}
          tone="emerald"
        />
        <MetricCell
          icon={Activity}
          label="frames"
          value={status?.frames ?? 0}
          tone="amber"
          format={(v) => Math.round(v).toLocaleString()}
        />
      </div>
    </div>
  );
}
