import { Bell, History, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import Card from "./Card.jsx";
import EmptyState from "./EmptyState.jsx";
import IncidentRow from "./IncidentRow.jsx";

// Right-side column on the Operations Console. Two stacked Cards:
//   Active     — ongoing events from the lifecycle layer, with running
//                 durations. Pulses while open.
//   History    — closed + one-shot events (recent first).
//
// All state comes from useEvents which the parent owns; we just render.
export default function LiveIncidents({ active, history, zones }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const activeList = Array.from(active?.values?.() || []);
  const zoneNameById = (zid) =>
    zones?.find((z) => z.id === zid)?.name || (zid ? String(zid).slice(0, 8) + "…" : null);
  const nowS = Date.now() / 1000;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <Card
        icon={Radio}
        title="Live"
        count={activeList.length}
        className="flex-1 min-h-0"
        bodyClassName="p-2 overflow-y-auto"
      >
        {activeList.length === 0 ? (
          <EmptyState icon={Bell} title="No active alerts" hint="Rule events appear here in real time." />
        ) : (
          <div className="space-y-1.5">
            {activeList.map((e) => (
              <IncidentRow
                key={`${e.module_id}|${e.track_id}|${e.zone_id || ""}|${e.missing || ""}`}
                ev={e}
                live
                nowS={nowS}
                zoneNameById={zoneNameById}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        icon={History}
        title="Recent"
        count={history?.length || 0}
        className="flex-1 min-h-0"
        bodyClassName="p-2 overflow-y-auto"
      >
        {!history?.length ? (
          <EmptyState icon={Bell} title="Nothing closed yet" hint="Completed events and one-shots will appear here." />
        ) : (
          <div className="space-y-1.5">
            {history.slice(0, 30).map((e, i) => (
              <IncidentRow
                key={i}
                ev={e}
                live={false}
                nowS={nowS}
                zoneNameById={zoneNameById}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
