"""Background inference worker.

Pipeline per camera (one worker per camera, managed by the Supervisor):

  FrameReader thread  ──►  Inference thread  ──►  ModuleEvaluator  ──►  WS fanout
   (latest frame)          (DAG of detectors)     (rule modules)        (asyncio queue)

The inference thread reads the latest frame, then for each detector module
configured on the camera, runs its model. Each detector produces its own
detections stream; the evaluator iterates rule modules and dispatches to the
right stream via the rule's `detector` field.

Idle policy: if the camera is disabled, has no detectors, or has no rules,
the worker skips inference entirely and just keeps ticking the loop so a
config edit propagates within ~200ms.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any

import cv2

import shutil
import subprocess
from pathlib import Path

import db
from modules import (
    DETECTOR_TYPES,
    RULE_TYPES,
    ModuleEvaluator,
)

_ENGINE_DIR = Path(__file__).resolve().parent


class FFmpegPublisher:
    """Encodes annotated BGR frames to H.264 and pushes them to MediaMTX
    via RTSP. The single encode is then fanned out to all viewers
    (WebRTC/HLS/RTSP) by MediaMTX — same pattern as Frigate's `restream`
    and DeepStream's `nvv4l2h264enc` → `rtspsink`.
    """

    def __init__(self, url: str, fps: float):
        self.url = url
        self.fps = max(1, int(round(fps)))
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self.width: int | None = None
        self.height: int | None = None
        self.frames_written = 0
        self.restart_count = 0
        self.last_error: str | None = None
        self._next_spawn_ts = 0.0      # earliest time we'll try ffmpeg again
        self._backoff_sec  = 1.0       # grows on repeated failures

    def _spawn(self, width: int, height: int):
        if shutil.which("ffmpeg") is None:
            self.last_error = "ffmpeg not on PATH"
            log.error("ffmpeg not on PATH — publisher disabled")
            return None
        # Backoff so a misconfigured target (MediaMTX down, wrong URL) doesn't
        # turn into a hot spawn loop burning CPU on subprocess churn.
        now = time.time()
        if now < self._next_spawn_ts:
            return None
        args = [
            "ffmpeg", "-y",
            "-loglevel", "warning",
            "-f", "rawvideo",
            "-pixel_format", "bgr24",
            "-video_size", f"{width}x{height}",
            "-framerate", str(self.fps),
            "-i", "-",                        # stdin = annotated BGR frames
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-g", str(max(2, self.fps * 2)),  # keyframe ~every 2 s
            "-bf", "0",                       # no B-frames → lower latency
            "-f", "rtsp",
            "-rtsp_transport", "tcp",
            self.url,
        ]
        log.info("ffmpeg publisher → %s  (%dx%d @ %d fps)", self.url, width, height, self.fps)
        proc = subprocess.Popen(
            args, stdin=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
        )
        # Drain stderr so it (a) doesn't fill the kernel pipe buffer and stall
        # ffmpeg, (b) surfaces useful errors when the target is down.
        threading.Thread(
            target=self._drain_stderr, args=(proc,), daemon=True,
            name=f"ffmpeg-stderr-{self.url.rsplit('/',1)[-1]}",
        ).start()
        self._next_spawn_ts = now + self._backoff_sec
        self._backoff_sec = min(self._backoff_sec * 2, 10.0)
        return proc

    def _drain_stderr(self, proc: subprocess.Popen) -> None:
        try:
            for raw in iter(proc.stderr.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip()
                if not line:
                    continue
                log.warning("ffmpeg: %s", line)
                self.last_error = line[:200]
        except Exception:
            pass

    def write(self, frame) -> None:
        h, w = frame.shape[:2]
        with self._lock:
            # First frame: lock in size and spawn ffmpeg.
            if self.width is None:
                self.width, self.height = w, h
                self._proc = self._spawn(w, h)
                self.restart_count += 1
            # Frame size changed (unlikely for fixed-source) — recycle ffmpeg.
            elif (w, h) != (self.width, self.height):
                log.warning("publisher: frame size changed %s → %s, restarting",
                            (self.width, self.height), (w, h))
                self._terminate_locked()
                self.width, self.height = w, h
                self._proc = self._spawn(w, h)
                self.restart_count += 1
            # ffmpeg died (e.g., MediaMTX restart, network blip) — respawn.
            elif self._proc is None or self._proc.poll() is not None:
                log.warning("publisher: ffmpeg exited, respawning")
                self._proc = self._spawn(self.width, self.height)
                self.restart_count += 1

            if self._proc is None:
                return
            try:
                self._proc.stdin.write(frame.tobytes())
                self.frames_written += 1
                # First successful frame after spawn = healthy — reset backoff.
                if self._backoff_sec > 1.0:
                    self._backoff_sec = 1.0
            except (BrokenPipeError, OSError) as e:
                self.last_error = f"pipe: {e}"
                log.warning("publisher pipe error: %s", e)
                self._terminate_locked()

    def _terminate_locked(self) -> None:
        if self._proc is None:
            return
        try:
            if self._proc.stdin and not self._proc.stdin.closed:
                self._proc.stdin.close()
        except Exception:
            pass
        try:
            self._proc.terminate()
            self._proc.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            self._proc.kill()
        except Exception:
            pass
        self._proc = None

    def stop(self) -> None:
        with self._lock:
            self._terminate_locked()

    def status(self) -> dict:
        with self._lock:
            return {
                "url":            self.url,
                "alive":          self._proc is not None and self._proc.poll() is None,
                "frames_written": self.frames_written,
                "restarts":       self.restart_count,
                "size":           f"{self.width}x{self.height}" if self.width else None,
                "last_error":     self.last_error,
            }

log = logging.getLogger("ai-engine.inference")


class _FrameReader(threading.Thread):
    """Keeps only the latest frame from an RTSP source. See main module docstring."""

    def __init__(self, url: str):
        super().__init__(daemon=True, name="frame-reader")
        self.url = url
        self._latest: Any = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.last_frame_ts = 0.0
        self.reconnect_count = 0

    def run(self) -> None:
        while not self._stop.is_set():
            log.info("frame reader: opening %s", self.url)
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                cap.release()
                self.reconnect_count += 1
                time.sleep(2.0)
                continue
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    log.warning("frame reader: cap.read failed — reconnecting")
                    break
                with self._lock:
                    self._latest = frame
                    self.last_frame_ts = time.time()
            cap.release()
            self.reconnect_count += 1
            time.sleep(1.0)

    def latest(self):
        with self._lock:
            return self._latest

    def shutdown(self) -> None:
        self._stop.set()


class InferenceEngine:
    def __init__(
        self,
        camera_id: str = "cam",
        target_fps: float = 5.0,
    ) -> None:
        self.camera_id = camera_id
        self.target_fps = target_fps

        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self.event_queue: asyncio.Queue | None = None
        self.evaluator = ModuleEvaluator()

        # Lazily-loaded model cache keyed by normalized name ("yolov8s.pt").
        # Loading on demand means a detector can be added/removed at runtime
        # without restarting the worker.
        self._models: dict[str, Any] = {}

        # Annotated JPEG ring of one — the latest frame with bboxes drawn on it.
        # Powers the /api/cameras/{id}/stream.mjpg endpoint (snapshots,
        # thumbnails, low-tech fallback). Live playback goes through the
        # FFmpegPublisher → MediaMTX path instead.
        self._jpeg_lock = threading.Lock()
        self.latest_jpeg: bytes | None = None
        self.latest_jpeg_ts: float = 0.0

        # H.264 republish: pushes the annotated stream to MediaMTX so all
        # viewers (browsers via WebRTC, mobile via HLS, RTSP recorders, etc.)
        # see a single canonical annotated feed produced by one encode.
        publish_url = (
            os.environ.get("AI_ENGINE_PUBLISH_URL")
            or f"rtsp://localhost:8554/{camera_id}-annotated"
        )
        self._publisher = FFmpegPublisher(publish_url, fps=target_fps)

        self.status: dict[str, Any] = {
            "camera_id":     camera_id,
            "running":       False,
            "yolo_running":  False,
            "idle":          None,   # "disabled" | "no_detectors" | "no_rules" | None
            "device":        None,
            "fps_target":    target_fps,
            "fps_actual":    0.0,
            "frames":        0,
            "imgsz":         None,
            "detectors":     {},     # det_id → { model, last_count }
            "last_error":    None,
        }

    def attach(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self._loop = loop
        self.event_queue = queue

    def read_jpeg(self) -> tuple[bytes | None, float]:
        """Snapshot the latest annotated JPEG + timestamp atomically."""
        with self._jpeg_lock:
            return self.latest_jpeg, self.latest_jpeg_ts

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"infer-{self.camera_id}", daemon=True)
        self._thread.start()
        self.status["running"] = True

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3.0)
        self.status["running"] = False

    # ── Worker ───────────────────────────────────────────────────────────

    def _run(self) -> None:
        try:
            from ultralytics import YOLO  # noqa: F401 — import probe
        except ImportError as e:
            log.error("ultralytics not installed: %s", e)
            self.status["last_error"] = "ultralytics not installed"
            self.status["running"] = False
            return

        device = self._best_device()
        self.status["device"] = device

        reader: _FrameReader | None = None
        current_source: str | None = None
        last_loop = 0.0
        spf = 1.0 / max(0.1, self.target_fps)
        frame_window: list[float] = []

        while not self._stop.is_set():
            try:
                config = db.get_camera(self.camera_id)
            except Exception as e:
                log.warning("config fetch failed: %s", e)
                config = None

            if not config:
                time.sleep(1.0)
                continue

            # Restart the reader if the source changed.
            if reader is None or current_source != config["source"]:
                if reader is not None:
                    reader.shutdown()
                current_source = config["source"]
                reader = _FrameReader(current_source)
                reader.start()
                t0 = time.time()
                while reader.latest() is None and time.time() - t0 < 5.0:
                    time.sleep(0.1)

            # FPS limit.
            now = time.time()
            wait = spf - (now - last_loop)
            if wait > 0:
                time.sleep(wait)
                now = time.time()
            last_loop = now

            # Idle guards. Detectors and rules are stored as separate arrays
            # in the camera's config blob.
            detectors = config.get("detectors") or []
            rules     = config.get("rules")     or []

            if not config.get("enabled", True):
                self._set_idle("disabled")
                continue
            if not detectors:
                self._set_idle("no_detectors")
                continue
            if not rules:
                # Detectors with no consumers — skip too. (We could still run
                # detection for UI overlay; keeping it strict for now.)
                self._set_idle("no_rules")
                continue

            self.status["idle"] = None
            self.status["yolo_running"] = True

            frame = reader.latest()
            if frame is None:
                self.status["last_error"] = "no frame from reader yet"
                continue
            if now - reader.last_frame_ts > 5.0:
                self.status["last_error"] = f"frame stale ({now - reader.last_frame_ts:.1f}s)"
                continue

            h, w = frame.shape[:2]
            imgsz = ((max(h, w) + 31) // 32) * 32
            self.status["imgsz"] = imgsz

            # Run each detector → per-detector stream of detections.
            detections_by_detector: dict[str, list[dict]] = {}
            flat: list[dict] = []
            det_status: dict[str, dict] = {}
            for det in detectors:
                det_id = det.get("id", "?")
                det_dets = self._run_detector(det, frame, device, imgsz)
                detections_by_detector[det_id] = det_dets
                det_status[det_id] = {
                    "type":  det.get("type"),
                    "model": det.get("model", "yolov8s"),
                    "count": len(det_dets),
                }
                for d in det_dets:
                    flat.append({**d, "detector_id": det_id})
            self.status["detectors"] = det_status

            # Hand the evaluator the canonical rule list (it would otherwise
            # have to repeat the same legacy-modules-fallback dance).
            eval_config = {
                "zones": config.get("zones", []),
                "rules": rules,
            }
            events = self.evaluator.evaluate(eval_config, detections_by_detector, now)

            self.status["frames"] += 1
            frame_window.append(now)
            frame_window = [t for t in frame_window if now - t < 5.0]
            self.status["fps_actual"] = round(len(frame_window) / 5.0, 2)
            self.status["last_error"] = None
            self.status["reader_reconnects"] = reader.reconnect_count

            # Burn bboxes onto a JPEG for the snapshot endpoint, and push the
            # same annotated frame (in raw BGR) to ffmpeg → MediaMTX for the
            # H.264 republish that drives all live viewers.
            annotated = self._annotate(frame, flat, events)
            self._encode_annotated_from(annotated, now)
            self._publisher.write(annotated)

            self._publish({
                "type":        "frame",
                "camera_id":   self.camera_id,
                "ts":          now,                          # when message was sent
                "frame_ts":    reader.last_frame_ts,         # ← capture-time sync key
                "frame_w":     int(frame.shape[1]),
                "frame_h":     int(frame.shape[0]),
                "detections":  flat,
                "events":      events,
            })

        if reader is not None:
            reader.shutdown()
        self._publisher.stop()

    def _set_idle(self, reason: str) -> None:
        self.status["idle"] = reason
        self.status["yolo_running"] = False
        self.status["detectors"] = {}

    # ── MJPEG annotation ─────────────────────────────────────────────────

    # BGR colors (OpenCV ordering). Track ids feeding into the same alert keep
    # the same color across frames so the stream is easy to follow visually.
    _BBOX_COLOR_INFO  = (250, 165,  96)   # blue-ish
    _BBOX_COLOR_ALERT = ( 68,  68, 239)   # red-ish
    _LABEL_FG         = (  0,   0,   0)

    def _annotate(self, frame: Any, detections: list[dict], events: list[dict]) -> Any:
        """Returns a new BGR frame with bboxes drawn. Always copies (the
        publisher needs a stable buffer and the JPEG encoder runs after)."""
        if not detections and not events:
            return frame.copy()
        alerting = {e.get("track_id") for e in events if e.get("track_id") is not None}
        annotated = frame.copy()
        for d in detections:
            x, y, w, h = d.get("bbox", [0, 0, 0, 0])
            x1, y1 = int(round(x)), int(round(y))
            x2, y2 = int(round(x + w)), int(round(y + h))
            color = self._BBOX_COLOR_ALERT if d.get("track_id") in alerting else self._BBOX_COLOR_INFO
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cls = str(d.get("class", "?"))
            tid = d.get("track_id", -1)
            label = f"{cls} #{tid} {int(round(d.get('conf', 0) * 100))}%" if tid >= 0 else \
                    f"{cls} {int(round(d.get('conf', 0) * 100))}%"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, max(0, y1 - th - 6)),
                          (x1 + tw + 6, y1), color, -1)
            cv2.putText(annotated, label, (x1 + 3, max(th + 2, y1 - 3)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, self._LABEL_FG, 1)
        return annotated

    def _encode_annotated_from(self, annotated: Any, ts: float) -> None:
        """Encode an already-annotated frame to JPEG for the snapshot endpoint."""
        self._publish_jpeg(annotated, ts)

    def _publish_jpeg(self, img: Any, ts: float) -> None:
        ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        if not ok:
            return
        data = buf.tobytes()
        with self._jpeg_lock:
            self.latest_jpeg = data
            self.latest_jpeg_ts = ts

    # ── Detection ────────────────────────────────────────────────────────

    def _run_detector(self, det: dict, frame: Any, device: str, imgsz: int) -> list[dict]:
        det_type = det.get("type")
        if det_type not in DETECTOR_TYPES:
            log.warning("unknown detector type: %s", det_type)
            return []
        # Same code path for object_detection, ppe_detection, and any future
        # YOLO-format detector. The model's `.names` carries the class map,
        # so detector_type is just metadata for the UI.
        return self._run_yolo(det, frame, device, imgsz)

    def _run_yolo(self, det: dict, frame: Any, device: str, imgsz: int) -> list[dict]:
        model_name = det.get("model") or "yolov8s"
        model = self._get_model(model_name)
        if model is None:
            return []

        names = getattr(model, "names", None) or {}
        if not names:
            log.warning("model %s exposes no class names", model_name)
            return []
        name_to_idx = {v: int(k) for k, v in names.items()}

        classes = det.get("classes") or []
        min_conf = float(det.get("min_conf", 0.5))
        cls_idxs = [name_to_idx[c] for c in classes if c in name_to_idx]
        # If the user picked classes but none match the model, emit nothing
        # rather than falling back to "everything".
        if classes and not cls_idxs:
            return []

        try:
            results = model.track(
                frame,
                persist=True,
                classes=cls_idxs or None,
                device=device,
                verbose=False,
                conf=min_conf,
                imgsz=imgsz,
            )
        except Exception as e:
            log.exception("detector %s inference failed", det.get("id"))
            self.status["last_error"] = f"detector {det.get('id')}: {e}"
            return []

        return self._parse_results(results, names)

    def _get_model(self, model_name: str):
        key = model_name if model_name.endswith(".pt") else f"{model_name}.pt"
        # Resolve relative paths against the ai-engine directory so configs
        # like "models/ppe.pt" work regardless of cwd.
        resolved = key
        if "/" in key and not key.startswith("/"):
            candidate = (_ENGINE_DIR / key).resolve()
            if candidate.exists():
                resolved = str(candidate)
        if resolved in self._models:
            return self._models[resolved]
        try:
            from ultralytics import YOLO
            log.info("loading model %s on %s", resolved, self.status["device"])
            self._models[resolved] = YOLO(resolved)
            return self._models[resolved]
        except Exception as e:
            log.exception("failed to load model %s", resolved)
            self._models[resolved] = None
            self.status["last_error"] = f"model load {resolved}: {e}"
            return None

    def _best_device(self) -> str:
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except ImportError:
            pass
        return "cpu"

    def _parse_results(self, results: Any, model_names: dict) -> list[dict]:
        out: list[dict] = []
        if not results:
            return out
        r = results[0]
        boxes = getattr(r, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return out
        ids = boxes.id
        for i, box in enumerate(boxes):
            cls_idx = int(box.cls.item())
            name = model_names.get(cls_idx)
            if not name:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            track_id = int(ids[i].item()) if ids is not None else -1
            out.append({
                "class":    name,
                "conf":     round(float(box.conf.item()), 3),
                "bbox":     [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],
                "track_id": track_id,
            })
        return out

    # ── Plumbing ─────────────────────────────────────────────────────────

    def _publish(self, msg: dict) -> None:
        if self._loop is None or self.event_queue is None:
            return
        try:
            self._loop.call_soon_threadsafe(self._queue_put_nowait, msg)
        except RuntimeError:
            pass

    def _queue_put_nowait(self, msg: dict) -> None:
        try:
            self.event_queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass
