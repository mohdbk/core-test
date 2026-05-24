"""ai-engine FastAPI app.

Serves:
- /api/cameras/*       CRUD for camera configs (zones + detectors + rules + enabled)
- /api/engine/status   per-camera worker status
- /ws/events?camera=X  WebSocket stream of detection events for ONE camera
- /api/cameras/{id}/stream.mjpg   annotated MJPEG snapshot stream (legacy/snapshot use)
- /info                first camera summary for cold-boot
- /                    static viewer from ../public

A Supervisor maintains one InferenceEngine per camera row. Each engine
publishes `{type:"frame", camera_id, detections, events}` onto a shared
asyncio queue; a broadcaster routes each message to the WebSocket clients
subscribed to that camera_id.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
from supervisor import Supervisor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ai-engine")

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

# Module-global state set up in lifespan.
supervisor:   Supervisor | None             = None
event_queue:  asyncio.Queue | None          = None
ws_by_camera: dict[str, set[WebSocket]]     = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global supervisor, event_queue
    db.init()
    db.ensure_default()

    event_queue = asyncio.Queue(maxsize=128)
    supervisor = Supervisor()
    supervisor.attach(asyncio.get_running_loop(), event_queue)
    await supervisor.start()

    broadcaster = asyncio.create_task(_broadcast_loop(), name="event-broadcaster")
    log.info("ai-engine started")
    try:
        yield
    finally:
        log.info("shutting down ai-engine…")
        broadcaster.cancel()
        await supervisor.stop()


async def _broadcast_loop() -> None:
    """Route each queued message to the WS clients subscribed to its camera."""
    assert event_queue is not None
    while True:
        msg = await event_queue.get()
        cam_id = msg.get("camera_id")
        clients = ws_by_camera.get(cam_id, set()) if cam_id else set()
        if not clients:
            continue
        text = json.dumps(msg, default=float)
        dead: list[WebSocket] = []
        for ws in clients:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)


app = FastAPI(title="ai-engine", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── REST: cameras ───────────────────────────────────────────────────────────

class CameraIn(BaseModel):
    id:           str | None = None
    name:         str | None = None
    source:       str | None = None
    image_width:  int | None = None
    image_height: int | None = None
    enabled:      bool | None = None
    zones:        list[Any] | None = None
    detectors:    list[Any] | None = None
    rules:        list[Any] | None = None


@app.get("/api/cameras")
def list_cameras() -> list[dict]:
    return db.list_cameras()


@app.get("/api/cameras/{camera_id}")
def get_camera(camera_id: str) -> dict:
    cam = db.get_camera(camera_id)
    if not cam:
        raise HTTPException(404, "camera not found")
    return cam


@app.post("/api/cameras")
async def create_camera(body: CameraIn) -> dict:
    if not body.source:
        raise HTTPException(400, "source is required")
    if body.id and db.get_camera(body.id):
        raise HTTPException(409, "camera id already exists")
    # If `id` is omitted, db.create_camera generates a UUID.
    created = db.create_camera(body.model_dump(exclude_none=True))
    assert created is not None
    if supervisor:
        await supervisor.sync()  # spawn the worker immediately
    return created


@app.put("/api/cameras/{camera_id}")
def update_camera(camera_id: str, body: CameraIn) -> dict:
    updated = db.update_camera(camera_id, body.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(404, "camera not found")
    return updated


@app.delete("/api/cameras/{camera_id}")
async def delete_camera(camera_id: str) -> dict:
    if not db.delete_camera(camera_id):
        raise HTTPException(404, "camera not found")
    if supervisor:
        await supervisor.sync()  # tear down the worker immediately
    return {"ok": True}


# ── Engine status (per-camera) ──────────────────────────────────────────────

@app.get("/api/engine/status")
def engine_status() -> dict:
    s = supervisor.status() if supervisor else {}
    return {
        "cameras":      s,
        "ws_by_camera": {cid: len(c) for cid, c in ws_by_camera.items()},
    }


# ── WebSocket: per-camera live detections + events ─────────────────────────

@app.websocket("/ws/events")
async def ws_events(ws: WebSocket, camera: str = "cam") -> None:
    await ws.accept()
    ws_by_camera.setdefault(camera, set()).add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_by_camera.get(camera, set()).discard(ws)


# ── MJPEG stream (server-side annotated) ────────────────────────────────────

@app.get("/api/cameras/{camera_id}/stream.mjpg")
async def stream_mjpg(camera_id: str):
    """Multipart MJPEG of frames with bboxes burned in by the engine.

    This is the zero-lag overlay path used by the Stream view: boxes are drawn
    on the same pixel buffer they were detected from, so they're always
    spatially aligned with the frame. The Config view keeps the WebRTC stream
    + client-side canvas for interactive zone editing.
    """
    if supervisor is None or camera_id not in supervisor.engines:
        raise HTTPException(404, "no engine for this camera")
    engine = supervisor.engines[camera_id]
    boundary = "ai-engine-frame"

    async def gen():
        last_ts = 0.0
        while True:
            jpeg, ts = await asyncio.to_thread(engine.read_jpeg)
            if jpeg and ts != last_ts:
                last_ts = ts
                yield (
                    f"--{boundary}\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n\r\n"
                ).encode("ascii") + jpeg + b"\r\n"
            await asyncio.sleep(0.05)

    headers = {"Cache-Control": "no-store", "Pragma": "no-cache"}
    return StreamingResponse(
        gen(),
        media_type=f"multipart/x-mixed-replace; boundary={boundary}",
        headers=headers,
    )


# ── Viewer convenience ──────────────────────────────────────────────────────

@app.get("/info")
def info() -> dict:
    # The frontend derives its WebRTC URL by convention from the selected
    # camera id ({id}-annotated/whep), so all this endpoint owes the cold-boot
    # page is the first camera in the system.
    cams = db.list_cameras()
    return {"cameras": cams[:1]}


# ── Static viewer (mounted last) ────────────────────────────────────────────
app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")
