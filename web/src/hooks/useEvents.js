import { useEffect, useRef, useState } from "react";
import { eventsWsUrl } from "../api.js";

// Subscribes to the per-camera WebSocket and returns a rolling event log +
// connection status. Detection boxes themselves are server-burned into the
// MJPEG/RTSP stream, so we only consume `events` here.
export function useEvents(cameraId) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("offline"); // offline | connecting | connected
  const wsRef = useRef(null);

  useEffect(() => {
    if (!cameraId) return;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      const ws = new WebSocket(eventsWsUrl(cameraId));
      wsRef.current = ws;
      ws.onopen = () => { if (!cancelled) setStatus("connected"); };
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
        setEvents((prev) => {
          const next = [...evs.map((ev) => ({ ...ev, ts: msg.ts })), ...prev];
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

  return { events, status };
}
