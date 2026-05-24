import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

// Polls /api/engine/status on an interval and exposes both the latest snapshot
// and a rolling buffer of (fps, frames) samples for sparkline visualisation.
const BUFFER = 40;   // ~80 seconds at the default 2s interval

export function useEngineStatus(cameraId, intervalMs = 2000) {
  const [status, setStatus] = useState(null);
  const [fpsSeries, setFpsSeries] = useState([]);
  const seriesRef = useRef([]);

  useEffect(() => {
    seriesRef.current = [];
    setFpsSeries([]);
    if (!cameraId) return;
    let cancelled = false;
    let timer;
    async function tick() {
      try {
        const s = await api.engineStatus();
        if (cancelled) return;
        const cam = s.cameras?.[cameraId] || null;
        setStatus(cam);
        if (cam) {
          seriesRef.current = [...seriesRef.current, Number(cam.fps_actual) || 0].slice(-BUFFER);
          setFpsSeries(seriesRef.current);
        }
      } catch {}
      timer = setTimeout(tick, intervalMs);
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraId, intervalMs]);

  return { status, fpsSeries };
}
