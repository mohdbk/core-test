import { useEffect, useRef, useState } from "react";
import { eventsWsUrl } from "../api.js";

// Subscribes to the per-camera WebSocket and decodes the backend's lifecycle
// events into two streams the UI cares about:
//
//   active  — events currently firing (enter / update phases). Keyed by
//             (module_id, track_id, zone_id, sub) so the UI can render one
//             live row per ongoing alert with a running duration.
//   history — completed events (exit phase) plus one-shot alerts that have
//             no lifecycle (line crossings, falls, unsafe-exit transitions).
//
// Backwards compatible with the old "no phase field" shape — those events
// land in history directly.
export function useEvents(cameraId) {
  const [active, setActive]   = useState(new Map());
  const [history, setHistory] = useState([]);
  const [status, setStatus]   = useState("offline");
  const wsRef = useRef(null);

  useEffect(() => {
    if (!cameraId) return;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      const ws = new WebSocket(eventsWsUrl(cameraId));
      wsRef.current = ws;
      ws.onopen  = () => { if (!cancelled) setStatus("connected"); };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus("offline");
        setTimeout(connect, 1500);
      };
      ws.onerror = () => { /* close fires after */ };
      ws.onmessage = (e) => {
        if (cancelled) return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type !== "frame") return;
        const evs = msg.events || [];
        if (!evs.length) return;

        setActive((prev) => {
          let next = prev;
          for (const ev of evs) {
            const phase = ev.phase;
            if (phase !== "enter" && phase !== "update" && phase !== "exit") continue;
            const k = eventKey(ev);
            if (next === prev) next = new Map(prev);
            if (phase === "exit") next.delete(k);
            else next.set(k, { ...ev, ts: msg.ts });
          }
          return next;
        });

        setHistory((prev) => {
          let next = prev;
          const additions = [];
          for (const ev of evs) {
            const phase = ev.phase;
            if (phase === "enter" || phase === "update") continue;
            additions.push({ ...ev, ts: msg.ts });
          }
          if (!additions.length) return prev;
          next = [...additions, ...prev];
          if (next.length > 100) next.length = 100;
          return next;
        });
      };
    }
    connect();
    return () => {
      cancelled = true;
      try { wsRef.current?.close(); } catch {}
    };
  }, [cameraId]);

  return { active, history, status };
}

function eventKey(ev) {
  return [
    ev.module_id || "?",
    ev.track_id  ?? "?",
    ev.zone_id   || "",
    ev.missing   || "",
  ].join("|");
}
