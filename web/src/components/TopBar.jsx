import {
  Cpu, Gauge, Layers, MonitorPlay, ShieldAlert, SlidersHorizontal, Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useCameras } from "../hooks/useCameras.js";
import { useEngineStatus } from "../hooks/useEngineStatus.js";
import Brand from "./Brand.jsx";
import KPI from "./KPI.jsx";
import StatusDot from "./StatusDot.jsx";
import Tooltip from "./Tooltip.jsx";

// Operations Console top bar. One row: brand · view tabs · live lamp ·
// KPI strip · version. Replaces the old NavRail + ContextBar split.
export default function TopBar({ cameraId, activeIncidentCount = 0 }) {
  const { status }  = useEngineStatus(cameraId);
  const { cameras } = useCameras();

  // 30-sample FPS sparkline (1 Hz). Throws away the read in steady state
  // when nothing has changed — keeps the line live without filling memory.
  const [series, setSeries] = useState([]);
  const ref = useRef(series); ref.current = series;
  useEffect(() => {
    const t = setInterval(() => {
      const v = Number(status?.fps_actual ?? 0);
      setSeries([...ref.current, v].slice(-30));
    }, 1000);
    return () => clearInterval(t);
  }, [status?.fps_actual]);

  const totalDet = cameras.reduce((a, c) => a + (c.detector_count || 0), 0);
  const totalRul = cameras.reduce((a, c) => a + (c.rule_count     || 0), 0);
  const live = !status?.idle && !status?.warming;

  return (
    <header className="h-14 flex items-stretch border-b border-white/[.06] bg-[var(--surface-1)]/95 backdrop-blur-xl">
      <div className="flex items-center pl-4 pr-3 border-r border-white/[.05]">
        <Brand />
      </div>

      <ViewTabs cameraId={cameraId} />

      <div className="flex-1 flex items-stretch overflow-x-auto">
        <Divider />
        <LiveLamp warming={status?.warming} idle={status?.idle} />
        <Divider />
        <KPI icon={Video}             label="Cameras"   value={cameras.length} tone="info" />
        <Divider />
        <KPI icon={Layers}            label="Detectors" value={totalDet} tone="info" />
        <Divider />
        <KPI icon={SlidersHorizontal} label="Rules"     value={totalRul} tone="info" />
        <Divider />
        <KPI
          icon={ShieldAlert}
          label="Live Alerts"
          value={activeIncidentCount}
          tone={activeIncidentCount > 0 ? "alert" : "neutral"}
        />
        <Divider />
        <KPI
          icon={Gauge}
          label="FPS"
          value={Number(status?.fps_actual ?? 0)}
          series={series}
          tone={live ? "live" : "neutral"}
          format={(v) => v.toFixed(1)}
        />
        <Divider />
        <KPI icon={Cpu} label="Device" value={(status?.device || "—").toUpperCase()} tone="neutral" />
      </div>

      <div className="flex items-center gap-2 px-4 border-l border-white/[.05]">
        <span className="text-[10px] tracking-wider uppercase text-text/40 font-mono">v0.3</span>
      </div>
    </header>
  );
}

function Divider() {
  return <div className="self-stretch w-px bg-white/[.05]" />;
}

function ViewTabs({ cameraId }) {
  const suffix = cameraId ? `/${cameraId}` : "";
  return (
    <nav className="flex items-stretch border-r border-white/[.05]">
      <Tab to={`/console${suffix}`} icon={MonitorPlay}        label="Console" />
      <Tab to={`/config${suffix}`}  icon={SlidersHorizontal} label="Configure" />
    </nav>
  );
}

function Tab({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "relative flex items-center gap-1.5 px-4 text-[12px] font-medium transition-colors",
          isActive ? "text-cyan-300" : "text-text/55 hover:text-text",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={13} strokeWidth={1.75} />
          {label}
          {isActive && (
            <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t bg-gradient-to-r from-cyan-400 to-violet-400 shadow-[0_0_12px_rgba(34,211,238,.55)]" />
          )}
        </>
      )}
    </NavLink>
  );
}

function LiveLamp({ warming, idle }) {
  const tone  = warming ? "warn" : idle ? "neutral" : "live";
  const label = warming ? "Warming" : idle ? `Idle · ${idle}` : "Live";
  return (
    <Tooltip label={`Engine ${label.toLowerCase()}`} side="bottom">
      <div className="flex items-center gap-2 px-3 whitespace-nowrap">
        <StatusDot tone={tone} pulse={!idle} />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text font-semibold">
          {label}
        </span>
      </div>
    </Tooltip>
  );
}
