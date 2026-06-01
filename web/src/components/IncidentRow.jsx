import {
  Activity, AlertTriangle, ArrowLeftRight, Ban, Eye, Gauge,
  LogOut, PauseCircle, Shield, ShieldAlert, UserCheck,
} from "lucide-react";
import { classLabel, crossingLabel, ppeLabel, ruleLabel } from "../lib/labels.js";
import StatusDot from "./StatusDot.jsx";
import Tag from "./Tag.jsx";

// One row per incident. Used both in the LiveIncidents feed (with running
// duration) and in the IncidentTicker (single-line pill form).
//
// Props:
//   ev          — event payload from useEvents
//   live        — true when this is currently open; shows a pulsing dot and
//                 keeps duration ticking
//   nowS        — current wall-clock seconds (UI ticks once a second)
//   zoneNameById — resolver from zone id → human name
//   compact     — single-line condensed form for the ticker
export default function IncidentRow({ ev, live, nowS, zoneNameById, compact }) {
  const tone     = SEVERITY[ev.severity] || SEVERITY.info;
  const TypeIcon = TYPE_ICON[ev.module_type] || Activity;
  const baseDur  = Number(ev.duration_s || 0);
  const drift    = Math.max(0, nowS - (ev.ts || nowS));
  const duration = live ? (baseDur + drift) : baseDur;
  const age      = Math.max(0, Math.floor(nowS - (ev.ts || nowS)));

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 h-6 rounded border whitespace-nowrap text-[11px]"
        style={{
          borderColor: `${tone.color}50`,
          background: `${tone.color}12`,
          color: tone.color,
        }}
      >
        <TypeIcon size={10} strokeWidth={2.25} />
        <span className="font-semibold">{ruleLabel(ev.module_type)}</span>
        <span className="opacity-80">
          {classLabel(ev.class)}{ev.track_id >= 0 ? ` · #${ev.track_id}` : ""}
        </span>
        {duration > 0 && <span className="opacity-70 font-mono tabular-nums">{formatDuration(duration)}</span>}
      </span>
    );
  }

  return (
    <div
      className="group flex items-center gap-2.5 px-2.5 py-2 rounded-md border transition-colors"
      style={{
        borderColor: live ? `${tone.color}50` : "rgba(255,255,255,.06)",
        background:  live ? `${tone.color}0d` : "transparent",
      }}
    >
      <div className="grid place-items-center w-7 h-7 rounded-md shrink-0"
           style={{ background: `${tone.color}1a`, color: tone.color }}>
        <TypeIcon size={13} strokeWidth={2} />
      </div>

      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {live && <StatusDot tone={ev.severity || "info"} pulse size={6} />}
          <Tag tone={live ? "live" : (ev.severity || "info")}>{ruleLabel(ev.module_type)}</Tag>
          <span className="text-[12px] text-text truncate">
            {classLabel(ev.class)}
            {ev.track_id != null && ev.track_id >= 0 && (
              <span className="text-text/55 font-mono ml-1">#{ev.track_id}</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-text/60 truncate">
          {ev.zone_id && <span>In <span className="text-text/80">{zoneNameById?.(ev.zone_id)}</span></span>}
          {ev.missing && <span className="text-amber-300">Missing {ppeLabel(ev.missing)}</span>}
          {ev.crossing && <span className="text-cyan-300">{crossingLabel(ev.crossing)}</span>}
          {ev.speed_m_per_sec != null && (
            <span className="text-amber-300 font-mono tabular-nums">
              {Number(ev.speed_m_per_sec).toFixed(1)} m/s
            </span>
          )}
          {ev.vehicle_class && (
            <span className="text-rose-300">From {classLabel(ev.vehicle_class)}</span>
          )}
          {!live && <span className="ml-auto font-mono tabular-nums">{age}s ago</span>}
        </div>
      </div>

      {duration > 0 && (
        <div className="shrink-0 text-right">
          <div className="font-mono tabular-nums text-[12px] font-semibold"
               style={{ color: tone.color }}>
            {formatDuration(duration)}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-text/40">
            {live ? "active" : "duration"}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(s) {
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

const SEVERITY = {
  alert:   { color: "#fb7185" },
  warning: { color: "#fbbf24" },
  info:    { color: "#22d3ee" },
};

const TYPE_ICON = {
  intrusion:         ShieldAlert,
  presence:          Eye,
  ppe_compliance:    Shield,
  restricted_zone:   Ban,
  idle_vehicle:      PauseCircle,
  speed_enforcement: Gauge,
  wrong_way:         ArrowLeftRight,
  lone_worker:       UserCheck,
  unsafe_exit:       LogOut,
  trip_fall:         AlertTriangle,
};
