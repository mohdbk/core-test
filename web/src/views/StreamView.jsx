import { MonitorPlay, Power } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCamera } from "../hooks/useCamera.js";
import { useCameras } from "../hooks/useCameras.js";
import { useEngineStatus } from "../hooks/useEngineStatus.js";
import { useEvents } from "../hooks/useEvents.js";
import CameraStage from "../components/CameraStage.jsx";
import EventsPanel from "../components/EventsPanel.jsx";
import IdBadge from "../components/IdBadge.jsx";
import MetadataBlock from "../components/MetadataBlock.jsx";
import Panel from "../components/Panel.jsx";

export default function StreamView() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const { cameras } = useCameras();

  useEffect(() => {
    if (!cameraId && cameras[0]?.id) {
      navigate(`/stream/${cameras[0].id}`, { replace: true });
    }
  }, [cameraId, cameras, navigate]);

  if (!cameraId)
    return <div className="h-full grid place-items-center text-subtle">Loading cameras…</div>;
  return <StreamViewWithCamera key={cameraId} cameraId={cameraId} />;
}

function StreamViewWithCamera({ cameraId }) {
  const { camera, zones } = useCamera(cameraId);
  const { status: engineStatus } = useEngineStatus(cameraId);
  const { events, status: wsStatus } = useEvents(cameraId);

  return (
    <div className="grid grid-cols-[1fr_400px] gap-3 h-full min-h-0">
      <div className="min-h-0 min-w-0 relative">
        <CameraStage cameraId={cameraId} zones={zones} editable={false} />
      </div>

      <aside className="overflow-y-auto pr-1 space-y-3 min-h-0">
        <Panel icon={MonitorPlay} title="Camera">
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate">{camera?.name || "—"}</div>
              <div className="text-[11px] text-subtle/80 mt-0.5">
                {camera?.enabled ? "Live · receiving annotated stream" : "Disabled · idle"}
              </div>
            </div>
            <span className={`pill ${camera?.enabled ? "text-cyan-400 border-cyan-400/30" : "text-subtle"}`}>
              <Power size={9} strokeWidth={2.5} />
              {camera?.enabled ? "on" : "off"}
            </span>
          </div>
          <MetadataBlock
            items={[
              { key: "id",         value: camera?.id ? <IdBadge id={camera.id} label="camera ID" variant="full" /> : null },
              { key: "source",     value: camera?.source ? <span className="font-mono text-[11px] break-all">{camera.source}</span> : null },
              { key: "resolution", value: camera ? `${camera.image_width || "?"}×${camera.image_height || "?"}` : null },
              { key: "zones",      value: zones.length },
              { key: "stream",     value: camera?.id ? <span className="font-mono text-[11px] break-all">{camera.id}-annotated</span> : null },
            ]}
          />
        </Panel>

        <EventsPanel events={events} wsStatus={wsStatus} engineStatus={engineStatus} zones={zones} />
      </aside>
    </div>
  );
}
