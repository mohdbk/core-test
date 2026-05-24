import { Activity, Eye, HelpCircle, Settings, SlidersHorizontal } from "lucide-react";
import { NavLink, useParams } from "react-router-dom";
import Tooltip from "./Tooltip.jsx";

// Left vertical nav rail — the app's primary navigation. Compact (52px wide),
// icon-only with tooltips. Active route gets a colored bar + glow.
export default function NavRail() {
  const { cameraId } = useParams();
  const suffix = cameraId ? `/${cameraId}` : "";

  return (
    <nav className="w-[52px] shrink-0 flex flex-col items-center gap-1 py-3 border-r border-white/[.04] bg-surface/40 backdrop-blur-xl">
      <BrandMark />
      <div className="h-px w-7 bg-white/5 my-2" />
      {/* Primary: live monitoring. Secondary: configure. */}
      <RailItem to={`/stream${suffix}`} icon={Eye} label="Live" />
      <RailItem to={`/config${suffix}`} icon={SlidersHorizontal} label="Configure" />
      <RailItem to="/events" icon={Activity} label="Activity" disabled />
      <div className="flex-1" />
      <RailItem to="/help" icon={HelpCircle} label="Help" disabled />
      <RailItem to="/settings" icon={Settings} label="Settings" disabled />
    </nav>
  );
}

function RailItem({ to, icon: Icon, label, disabled }) {
  if (disabled) {
    return (
      <Tooltip label={`${label} · coming soon`} side="right">
        <button
          disabled
          className="relative w-9 h-9 grid place-items-center rounded-lg text-muted/50 cursor-not-allowed"
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={label} side="right">
      <NavLink
        to={to}
        className={({ isActive }) =>
          [
            "relative w-9 h-9 grid place-items-center rounded-lg transition-colors",
            isActive
              ? "text-cyan-400 bg-cyan-400/[.08] shadow-[inset_0_0_0_1px_rgba(34,211,238,.25)]"
              : "text-subtle hover:text-text hover:bg-white/[.05]",
          ].join(" ")
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="accent-bar" />}
            <Icon size={16} strokeWidth={1.5} />
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}

function BrandMark() {
  return (
    <div className="relative w-9 h-9 grid place-items-center rounded-lg bg-gradient-to-br from-cyan-400/25 to-violet-500/25 border border-white/15 shadow-[0_0_20px_-8px_rgba(34,211,238,.55)]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
