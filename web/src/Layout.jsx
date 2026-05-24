import { useLocation, useNavigate, Outlet } from "react-router-dom";
import CameraList from "./components/CameraList.jsx";
import ContextBar from "./components/ContextBar.jsx";
import NavRail from "./components/NavRail.jsx";

export default function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const isStream = loc.pathname.startsWith("/stream");
  const switchCamera = (id) => {
    nav(`${isStream ? "/stream" : "/config"}/${id}`);
  };

  return (
    <div className="h-screen flex">
      <NavRail />
      <CameraList />
      <div className="flex-1 flex flex-col min-w-0">
        <ContextBar onSwitchCamera={switchCamera} />
        <main className="flex-1 min-h-0 px-4 pb-4 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
