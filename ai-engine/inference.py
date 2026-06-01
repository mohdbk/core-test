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
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import cv2
import numpy as np

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
        # Per-model lock so the thread pool can run two different models
        # concurrently but never race two threads against the same YOLO
        # instance's internal tracker state.
        self._model_locks: dict[str, threading.Lock] = {}
        self._model_locks_guard = threading.Lock()
        # model_id → weights_path lookup cache to avoid hitting SQLite every
        # frame. Cleared by engine restart only — model rows are effectively
        # immutable for the purposes of inference (rename/description only).
        self._mid_to_path: dict[str, str | None] = {}

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

        # Per-detector signature ("which model + which classes are loaded?").
        # When this changes for a detector, YOLO's internal tracker would
        # renumber tracks under us — we drop the model from cache so the
        # next inference reloads it cleanly and reset the rule evaluator's
        # per-track state so we don't carry over stale dwell timers.
        self._detector_sigs: dict[str, str] = {}

        # Camera-config cache. Read `cameras.updated_at` every frame (cheap,
        # one row); only refetch the full normalized tree when it changes.
        # Saves ~3 SQLite queries per frame in steady state.
        self._cached_config: dict | None = None
        self._cached_config_ts: str | None = None

        # Models that have completed a warm-up forward pass. First-call
        # latency on MPS/CUDA can be 1-2 s; we burn that cost up front so
        # the first user-visible frame doesn't look broken.
        self._warmed: set[str] = set()

        # Thread pool used to parallelize multi-detector inference. YOLO
        # releases the GIL during model.track(), so threading actually
        # parallelizes on MPS/CUDA.
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix=f"infer-{camera_id}")

        self.status: dict[str, Any] = {
            "camera_id":     camera_id,
            "running":       False,
            "yolo_running":  False,
            "idle":          None,   # "disabled" | "no_detectors" | "no_rules" | None
            "warming":       False,
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
        self._pool.shutdown(wait=False, cancel_futures=True)
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
                config = self._fetch_config()
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

            # Detect signature changes (different model_id / classes / conf)
            # so we can reset YOLO's internal tracker before the ID space
            # gets stomped on.
            self._handle_signature_changes(detectors)

            # Warm-up: pay the first-inference cost (model load + device init)
            # on a blank frame so the first real frame isn't visibly stalled.
            self._maybe_warmup(detectors, device, imgsz)

            # Run each detector → per-detector stream of detections. With
            # multiple detectors we fan out across a thread pool; YOLO drops
            # the GIL inside predict/track so this actually parallelizes.
            detections_by_detector: dict[str, list[dict]] = {}
            flat: list[dict] = []
            det_status: dict[str, dict] = {}
            if len(detectors) <= 1:
                results_pairs = [(d, self._run_detector(d, frame, device, imgsz)) for d in detectors]
            else:
                futs = [(d, self._pool.submit(self._run_detector, d, frame, device, imgsz)) for d in detectors]
                results_pairs = []
                for d, fut in futs:
                    try:
                        results_pairs.append((d, fut.result(timeout=10.0)))
                    except Exception as e:
                        log.warning("detector %s failed in pool: %s", d.get("id"), e)
                        results_pairs.append((d, []))
            for det, det_dets in results_pairs:
                det_id = det.get("id", "?")
                detections_by_detector[det_id] = det_dets
                det_status[det_id] = {
                    "type":     det.get("type"),
                    "model_id": det.get("model_id"),
                    "model":    self._resolve_weights(det) or det.get("model"),
                    "count":    len(det_dets),
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

    def _fetch_config(self) -> dict | None:
        ts = db.get_camera_updated_at(self.camera_id)
        if ts is None:
            self._cached_config = None
            self._cached_config_ts = None
            return None
        if ts != self._cached_config_ts:
            self._cached_config = db.get_camera(self.camera_id)
            self._cached_config_ts = ts
        return self._cached_config

    def _set_idle(self, reason: str) -> None:
        self.status["idle"] = reason
        self.status["yolo_running"] = False
        self.status["detectors"] = {}

    # ── Detector signature / warm-up ─────────────────────────────────────

    def _detector_signature(self, det: dict) -> str:
        payload = {
            "model_id": det.get("model_id"),
            "model":    det.get("model"),
            "min_conf": det.get("min_conf"),
            "classes":  sorted(det.get("classes") or []),
            "type":     det.get("type"),
        }
        return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]

    def _handle_signature_changes(self, detectors: list[dict]) -> None:
        changed = False
        for det in detectors:
            det_id = det.get("id")
            if not det_id:
                continue
            sig = self._detector_signature(det)
            prev = self._detector_sigs.get(det_id)
            if prev is not None and prev != sig:
                log.info("detector %s signature changed; resetting tracker", det_id)
                changed = True
                # Best-effort tracker reset on the loaded YOLO instance. If
                # ultralytics changes its tracker API, we fall through to a
                # full evaluator reset below — track IDs may renumber but
                # state stays consistent.
                path = self._resolve_weights(det)
                if path:
                    key = path if path.endswith(".pt") else f"{path}.pt"
                    candidate = _ENGINE_DIR / "models" / key
                    for resolved in (key, str(candidate.resolve())):
                        model = self._models.get(resolved)
                        if model is None:
                            continue
                        try:
                            predictor = getattr(model, "predictor", None)
                            for t in getattr(predictor, "trackers", []) or []:
                                t.reset()
                        except Exception as e:
                            log.warning("tracker reset failed: %s", e)
            self._detector_sigs[det_id] = sig
        if changed:
            self.evaluator.reset()
            self.status["last_error"] = None
            log.info("evaluator state reset after detector signature change")

    def _maybe_warmup(self, detectors: list[dict], device: str, imgsz: int) -> None:
        """Run one inference per unique model on a black `imgsz`-sized frame
        to amortize the first-call latency (model load + device init)."""
        unique_paths: list[tuple[str, Any]] = []
        for det in detectors:
            path = self._resolve_weights(det)
            if not path:
                continue
            key = path if path.endswith(".pt") else f"{path}.pt"
            warm_key = f"{key}@{imgsz}@{device}"
            if warm_key in self._warmed:
                continue
            model = self._get_model(path)
            if model is None:
                continue
            unique_paths.append((warm_key, model))
        if not unique_paths:
            return
        self.status["warming"] = True
        blank = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
        try:
            for warm_key, model in unique_paths:
                t0 = time.time()
                try:
                    model.predict(blank, device=device, verbose=False, imgsz=imgsz)
                    self._warmed.add(warm_key)
                    log.info("warmed %s in %.0f ms", warm_key, (time.time() - t0) * 1000)
                except Exception as e:
                    log.warning("warm-up failed for %s: %s", warm_key, e)
        finally:
            self.status["warming"] = False

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
        model_name = self._resolve_weights(det) or "yolov8s"
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
            with self._lock_for(model_name):
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

    def _lock_for(self, model_name: str) -> threading.Lock:
        with self._model_locks_guard:
            lock = self._model_locks.get(model_name)
            if lock is None:
                lock = threading.Lock()
                self._model_locks[model_name] = lock
            return lock

    def _resolve_weights(self, det: dict) -> str | None:
        """Resolve a detector's chosen model to a weights path. Preference:
        `model_id` → DB lookup → weights_path. Falls back to the legacy
        `model` string (a bare name or relative path) so detectors created
        before the models table existed still work."""
        mid = det.get("model_id")
        if mid:
            if mid not in self._mid_to_path:
                m = db.get_model(mid)
                self._mid_to_path[mid] = m["weights_path"] if m else None
            path = self._mid_to_path[mid]
            if path:
                return path
            # Unknown model_id → try the legacy field rather than failing.
            log.warning("detector %s references unknown model_id=%s",
                        det.get("id"), mid)
        return det.get("model")

    def _get_model(self, model_name: str):
        key = model_name if model_name.endswith(".pt") else f"{model_name}.pt"
        # Resolution order:
        #   1. absolute path → use as-is
        #   2. contains a slash (relative path like "models/ppe.pt") → resolve
        #      against the ai-engine dir
        #   3. bare name like "yolov8s" → prefer ai-engine/models/<name>.pt if
        #      it exists; otherwise fall through to ultralytics' default
        #      auto-download behavior.
        resolved = key
        if key.startswith("/"):
            pass  # absolute path
        elif "/" in key:
            candidate = (_ENGINE_DIR / key).resolve()
            if candidate.exists():
                resolved = str(candidate)
        else:
            packaged = (_ENGINE_DIR / "models" / key).resolve()
            if packaged.exists():
                resolved = str(packaged)
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
        # Pose models expose `r.keypoints` with one row per detection. Each row
        # has shape (K, 2 or 3): xy + optional conf. Older Ultralytics versions
        # split xy and conf into separate tensors; handle both.
        keypoints_obj = getattr(r, "keypoints", None)
        kps_data = None
        if keypoints_obj is not None:
            data = getattr(keypoints_obj, "data", None)
            if data is not None and len(data) > 0:
                kps_data = data
        for i, box in enumerate(boxes):
            cls_idx = int(box.cls.item())
            name = model_names.get(cls_idx)
            if not name:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            track_id = int(ids[i].item()) if ids is not None else -1
            det: dict[str, Any] = {
                "class":    name,
                "conf":     round(float(box.conf.item()), 3),
                "bbox":     [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],
                "track_id": track_id,
            }
            if kps_data is not None and i < len(kps_data):
                row = kps_data[i].tolist()
                # Normalize to [[x, y, conf], ...]; pad conf=1.0 if missing.
                det["keypoints"] = [
                    [round(float(p[0]), 1), round(float(p[1]), 1),
                     round(float(p[2]), 3) if len(p) > 2 else 1.0]
                    for p in row
                ]
            out.append(det)
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
