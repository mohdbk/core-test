import { Outlet, useParams } from "react-router-dom";
import { useCameras } from "./hooks/useCameras.js";
import { useCamera } from "./hooks/useCamera.js";
import { useEvents } from "./hooks/useEvents.js";
import CameraList from "./components/CameraList.jsx";
import IncidentTicker from "./components/IncidentTicker.jsx";
import LiveIncidents from "./components/LiveIncidents.jsx";
import TopBar from "./components/TopBar.jsx";

// Operations Console shell.
//
//   ┌─ TopBar ────────────────────────────────────────────────────────────┐
//   ├─ CameraList ─┬─ Outlet (stage) ────────────────┬─ LiveIncidents ─┤
//   └─ IncidentTicker ──────────────────────────────────────────────────┘
//
// The shell owns the per-camera events stream so the stage, the right
// column, and the bottom ticker stay perfectly in sync without each
// re-subscribing to the WebSocket. The Outlet receives the data via
// React Router context.
export default function Layout() {
  const { cameraId } = useParams();
  const { cameras } = useCameras();
  // Resolve a camera id even on the bare `/console` route so the right rail
  // and ticker have something to subscribe to.
  const resolvedId = cameraId || cameras[0]?.id;

  const { zones } = useCamera(resolvedId);
  const { active, history, status: wsStatus } = useEvents(resolvedId);

  return (
    <div className="h-screen flex flex-col bg-canvas">
      <TopBar cameraId={resolvedId} activeIncidentCount={active?.size || 0} />

      <main
        className="flex-1 min-h-0 grid gap-3 p-3"
        style={{ gridTemplateColumns: "232px 1fr 340px" }}
      >
        <CameraList />
        <div className="min-h-0 min-w-0">
          <Outlet context={{ cameraId: resolvedId, zones, active, history, wsStatus }} />
        </div>
        <LiveIncidents active={active} history={history} zones={zones} />
      </main>

      <IncidentTicker history={history} />
    </div>
  );
}
