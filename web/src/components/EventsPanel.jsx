import {
  Activity, AlertTriangle, Bell, ChevronRight, Cpu, Eye, ShieldAlert, Wifi, WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import Panel from "./Panel.jsx";

const SEV = {
  alert:   { fg: "text-rose-400",   bg: "bg-rose-500/[.07]",  border: "border-rose-500/30", Icon: ShieldAlert },
  warning: { fg: "text-amber-400",  bg: "bg-amber-500/[.07]", border: "border-amber-500/30", Icon: AlertTriangle },
  info:    { fg: "text-cyan-400",   bg: "bg-cyan-400/[.05]",  border: "border-cyan-400/20", Icon: Activity },
};

const TYPE_ICON = {
  intrusion:      ShieldAlert,
  presence:       Eye,
  ppe_compliance: Activity,
};

export default function EventsPanel({ events, wsStatus, engineStatus, zones }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const zoneNameById = (zid) => zones?.find((z) => z.id === zid)?.name || (zid ? String(zid).slice(0, 8) + "…" : null);
  const nowS = Date.now() / 1000;

  return (
    <Panel
      icon={Cpu}
      title="AI Engine"
      right={<EngineSummary wsStatus={wsStatus} engineStatus={engineStatus} />}
    >
      <div className="space-y-1 max-h-[34vh] overflow-auto -mx-1 px-1">
        {events.length === 0 && (
          <div className="flex items-center gap-2 text-subtle/80 text-xs px-2 py-4">
            <Bell size={13} strokeWidth={1.75} className="text-subtle/60" />
            No events yet — configure a rule to start.
          </div>
        )}
        {events.map((e, i) => {
          const sev = SEV[e.severity] || SEV.info;
          const TypeIcon = TYPE_ICON[e.module_type] || Activity;
          const age = Math.max(0, (nowS - e.ts) | 0);
          return (
            <div
              key={i}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${sev.bg} ${sev.border}`}
            >
              <TypeIcon size={12} strokeWidth={2} className={`${sev.fg} shrink-0`} />
              <span className={`${sev.fg} font-mono text-[10px] uppercase tracking-wider font-semibold`}>
                {e.module_type}
              </span>
              <ChevronRight size={10} className="text-subtle/50 shrink-0" />
              <span className="text-[11px] truncate text-text">
                {e.class}
                {e.track_id != null && e.track_id >= 0 && (
                  <span className="text-subtle/80 ml-1">#{e.track_id}</span>
                )}
              </span>
              {e.missing && (
                <span className="text-amber-400 text-[10px] font-mono">missing {e.missing}</span>
              )}
              {e.crossing && (
                <span className="text-cyan-400 text-[10px] font-mono">{e.crossing}</span>
              )}
              {e.zone_id && (
                <span className="text-subtle/70 text-[10px] truncate">in {zoneNameById(e.zone_id)}</span>
              )}
              {e.duration_s ? (
                <span className="text-violet-400 text-[10px] font-mono">{e.duration_s}s</span>
              ) : null}
              <span className="ml-auto text-subtle/50 text-[10px] font-mono">{age}s</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function EngineSummary({ wsStatus, engineStatus }) {
  const connected = wsStatus === "connected";
  const Icon = connected ? Wifi : WifiOff;
  const fg = connected ? "text-cyan-400" : "text-subtle";

  let detail = null;
  if (engineStatus) {
    if (engineStatus.idle) detail = `idle · ${engineStatus.idle}`;
    else detail = `${engineStatus.device || "?"} · ${engineStatus.fps_actual ?? 0} fps`;
  } else if (!connected) {
    detail = "disconnected";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${fg}`}>
      <Icon size={11} strokeWidth={2} />
      {detail || wsStatus}
    </span>
  );
}
