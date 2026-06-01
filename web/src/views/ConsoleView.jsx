import { Maximize2, MonitorPlay, Power } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useCamera } from "../hooks/useCamera.js";
import { useCameras } from "../hooks/useCameras.js";
import CameraStage from "../components/CameraStage.jsx";
import Card from "../components/Card.jsx";
import EmptyState from "../components/EmptyState.jsx";
import IdBadge from "../components/IdBadge.jsx";
import MetadataBlock from "../components/MetadataBlock.jsx";
import StatusDot from "../components/StatusDot.jsx";
import Tag from "../components/Tag.jsx";

// Primary monitoring view. The stream takes the visual lion's share; a slim
// info strip below holds the camera card. Right-rail live incidents and the
// bottom incident ticker are owned by the Layout shell, so this view is
// intentionally focused.
export default function ConsoleView() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const { cameras } = useCameras();

  // Redirect to the first available camera if the URL has none.
  useEffect(() => {
    if (!cameraId && cameras[0]?.id) {
      navigate(`/console/${cameras[0].id}`, { replace: true });
    }
  }, [cameraId, cameras, navigate]);

  if (!cameraId) return <ConsoleEmpty />;
  return <ConsoleWithCamera key={cameraId} cameraId={cameraId} />;
}

function ConsoleWithCamera({ cameraId }) {
  const { camera, zones, setEnabled } = useCamera(cameraId);
  const stageRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);

  function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setFullscreen(false));
    }
  }
  useEffect(() => {
    function onFs() { setFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex-1 min-h-0 relative" ref={stageRef}>
        <CameraStage cameraId={cameraId} zones={zones} editable={false} />

        {/* Overlay HUD: camera name + status, top-left */}
        <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-black/55 backdrop-blur-xl border border-white/[.10]">
          <StatusDot tone={camera?.enabled ? "live" : "neutral"} pulse={!!camera?.enabled} size={7} />
          <span className="text-[12px] font-semibold text-text">{camera?.name || "—"}</span>
          <span className="font-mono text-[10px] text-text/50 ml-1">
            {camera?.image_width || "?"}×{camera?.image_height || "?"}
          </span>
        </div>

        {/* Overlay actions: top-right */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button
            onClick={() => setEnabled(!camera?.enabled)}
            className={[
              "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium border backdrop-blur-xl transition-colors",
              camera?.enabled
                ? "bg-cyan-400/[.10] border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/[.18]"
                : "bg-black/55 border-white/[.10] text-text/70 hover:bg-white/[.06]",
            ].join(" ")}
          >
            <Power size={11} strokeWidth={2.25} />
            {camera?.enabled ? "Streaming" : "Off"}
          </button>
          <button
            onClick={toggleFullscreen}
            title="Fullscreen"
            className="grid place-items-center w-7 h-7 rounded-md bg-black/55 border border-white/[.10] text-text/70 hover:text-text hover:bg-white/[.06] backdrop-blur-xl transition-colors"
          >
            <Maximize2 size={12} strokeWidth={2} />
          </button>
        </div>
      </div>

      <Card icon={MonitorPlay} title="Camera" right={<CameraTags enabled={camera?.enabled} zones={zones} />}>
        <MetadataBlock
          defaultOpen
          items={[
            { key: "id",         value: camera?.id ? <IdBadge id={camera.id} label="camera ID" variant="full" /> : null },
            { key: "source",     value: camera?.source ? <span className="font-mono text-[11px] break-all text-text/80">{camera.source}</span> : null },
            { key: "resolution", value: camera ? `${camera.image_width || "?"} × ${camera.image_height || "?"}` : null },
            { key: "stream",     value: camera?.id ? <span className="font-mono text-[11px] break-all text-text/80">{camera.id}-annotated</span> : null },
          ]}
        />
      </Card>
    </div>
  );
}

function CameraTags({ enabled, zones }) {
  return (
    <div className="flex items-center gap-1.5">
      <Tag tone={enabled ? "live" : "neutral"}>{enabled ? "live" : "off"}</Tag>
      <Tag tone="info">{zones?.length || 0} zones</Tag>
    </div>
  );
}

function ConsoleEmpty() {
  return (
    <Card title="Console" className="h-full">
      <EmptyState
        icon={MonitorPlay}
        title="No camera selected"
        hint="Add a camera or pick one from the list on the left."
      />
    </Card>
  );
}
