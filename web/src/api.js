// Thin wrapper over the ai-engine REST API. Vite proxies /api → :8000
// during development; in a production build you'd serve the React bundle
// from the same FastAPI process (or behind the same reverse-proxy).

async function json(input, init) {
  const res = await fetch(input, init);
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch {}
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export const api = {
  listCameras: () => json("/api/cameras"),
  getCamera:   (id) => json(`/api/cameras/${encodeURIComponent(id)}`),
  createCamera: (body) =>
    json("/api/cameras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateCamera: (id, body) =>
    json(`/api/cameras/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteCamera: (id) =>
    fetch(`/api/cameras/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return true;
    }),
  engineStatus: () => json("/api/engine/status"),

  // ── models ───────────────────────────────────────────────────────────
  listModels:  () => json("/api/models"),
  getModel:    (id) => json(`/api/models/${encodeURIComponent(id)}`),
  createModel: (body) =>
    json("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateModel: (id, body) =>
    json(`/api/models/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteModel: (id) =>
    fetch(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return true;
    }),
};

// Build the WebRTC WHEP URL for a camera's annotated stream. The engine
// publishes via ffmpeg to MediaMTX path "{id}-annotated"; that's what we
// consume here.
export function whepUrl(cameraId) {
  return `http://${location.hostname}:8889/${encodeURIComponent(cameraId)}-annotated/whep`;
}

// WebSocket URL for live events from the AI engine, scoped to one camera.
export function eventsWsUrl(cameraId) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/events?camera=${encodeURIComponent(cameraId)}`;
}
