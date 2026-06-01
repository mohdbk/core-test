import { Activity } from "lucide-react";
import IncidentRow from "./IncidentRow.jsx";

// Bottom strip on the Operations Console. A horizontal marquee of the most
// recent incident pills. Pauses on hover so an operator can read details.
//
// Duplicates the list inline so the CSS marquee loops seamlessly without a
// JS animation frame loop.
export default function IncidentTicker({ history }) {
  const items = (history || []).slice(0, 25);
  const nowS = Date.now() / 1000;

  return (
    <div className="h-9 flex items-center border-t border-white/[.06] bg-[var(--surface-1)]/95 backdrop-blur-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 border-r border-white/[.05] shrink-0 h-full">
        <Activity size={11} strokeWidth={2.25} className="text-text/45" />
        <span className="text-[10px] uppercase tracking-[0.16em] text-text/50 font-medium">
          Incidents
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative">
        {items.length === 0 ? (
          <div className="absolute inset-0 flex items-center px-3 text-[11px] text-text/40 font-mono">
            no recent incidents
          </div>
        ) : (
          <div className="absolute inset-y-0 left-0 flex items-center gap-2 marquee will-change-transform pl-3 pr-6">
            {[...items, ...items].map((e, i) => (
              <IncidentRow
                key={i}
                ev={e}
                compact
                live={false}
                nowS={nowS}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
