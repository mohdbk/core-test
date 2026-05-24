import { Eye, SlidersHorizontal } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useCameras } from "../hooks/useCameras.js";
import CameraSwitcher from "./CameraSwitcher.jsx";

export default function TopBar() {
  const { cameras, refresh } = useCameras();
  const params = useParams();
  const loc = useLocation();
  const nav = useNavigate();

  const isStream = loc.pathname.startsWith("/stream");
  const viewPrefix = isStream ? "/stream" : "/config";
  const currentCameraId = params.cameraId || cameras[0]?.id;

  function switchTo(id) {
    nav(`${viewPrefix}/${id}`);
  }

  return (
    <header className="px-4 pt-3 pb-2">
      <div className="surface rounded-xl px-3 py-2 flex items-center gap-3">
        <Link
          to="/config"
          className="flex items-center gap-2.5 pr-3 mr-1 border-r border-white/5"
        >
          <Logo />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">tanbeeh</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-subtle/70 font-medium">
              vision intel
            </div>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          <Tab to={`/config${currentCameraId ? "/" + currentCameraId : ""}`} icon={SlidersHorizontal}>
            Configure
          </Tab>
          <Tab to={`/stream${currentCameraId ? "/" + currentCameraId : ""}`} icon={Eye}>
            Stream
          </Tab>
        </nav>

        <div className="flex-1" />

        <CameraSwitcher
          cameras={cameras}
          currentId={currentCameraId}
          onSelect={switchTo}
          onCameraAdded={refresh}
        />
      </div>
    </header>
  );
}

function Tab({ to, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md transition-colors",
          isActive
            ? "text-text bg-white/[.07] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]"
            : "text-subtle hover:text-text hover:bg-white/[.04]",
        ].join(" ")
      }
    >
      <Icon size={13} strokeWidth={1.75} />
      {children}
    </NavLink>
  );
}

function Logo() {
  return (
    <div className="relative w-7 h-7 grid place-items-center rounded-md bg-gradient-to-br from-cyan-400/20 to-violet-500/20 border border-white/10">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="url(#lg)" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3.5" stroke="url(#lg)" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="1.4" fill="#22d3ee" />
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#22d3ee" />
            <stop offset="1" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
