"""Module evaluators — rules consume detections from detectors.

Three big pieces beyond the per-rule logic:

  1. **Hysteresis** — every per-track state dict is kept for a few seconds
     after a track stops appearing in detections, so brief tracker hiccups
     (a 1-frame ID swap, a 0.5 s occlusion) don't wipe dwell timers or close
     in-flight events. See `TRACK_HYSTERESIS_S` and `_gc`.

  2. **Event lifecycle** — continuous rules ("person is in restricted zone",
     "vehicle is idling") emit `phase: enter / update / exit` events instead
     of firing every frame. The lifecycle bookkeeping lives in
     `self.open_events`; rules just declare which `(rule, track, zone)` keys
     are active this frame and the evaluator handles the rest.

  3. **Homography** — `speed_enforcement` prefers a 4-point ground homography
     on its polygon zone (`use_homography` + `ground_w_m` + `ground_h_m`)
     when set, falling back to a flat `scale_px_per_m`, and finally to raw
     pixel speed if nothing is calibrated.

One-shot rules (line crossings, wrong-way transitions, unsafe-exit moment,
trip-fall moment) keep firing as discrete events without a phase field.
"""

from __future__ import annotations

import datetime
import math
from collections import deque
from typing import Any

import cv2
import numpy as np


DETECTOR_TYPES: set[str] = {"object_detection", "ppe_detection", "pose_detection"}
RULE_TYPES:     set[str] = {
    "intrusion", "presence", "ppe_compliance",
    "speed_enforcement", "restricted_zone", "idle_vehicle",
    "wrong_way", "unsafe_exit", "lone_worker", "trip_fall",
}

PPE_NEGATIVE_TO_POSITIVE: dict[str, str] = {
    "head_nohelmet":     "head_helmet",
    "face_nomask":       "face_mask",
    "hand_noglove":      "hand_glove",
    "No_Glasses":        "glasses",
    "No_Ear-Protection": "Ear-protection",
    "Barefoots":         "boots",
    "Sandals":           "boots",
}

# Per-track state survives this long after the track stops appearing. Tuned
# so a 5-second occlusion doesn't reset a 30-second idle dwell.
TRACK_HYSTERESIS_S = 6.0

# Continuous events emit phase="update" at this cadence while open.
LIFECYCLE_UPDATE_INTERVAL_S = 2.0

# Speed debounce: need this many consecutive over/under frames to flip state.
SPEED_DEBOUNCE_FRAMES = 3

# Unsafe-exit: require this many consecutive frames of overlap before
# recording the person as "inside" the vehicle.
UNSAFE_EXIT_INSIDE_FRAMES = 2

# Unsafe-exit: vehicle is considered parked if its foot moved less than this
# (in px) over the last second of history.
UNSAFE_EXIT_PARKED_PX = 8.0

# Trip-fall confirmation: after a collapse is detected, require the person
# to stay collapsed for this long before firing the alert.
FALL_SUSTAINED_S = 1.0


# ── Geometry helpers ────────────────────────────────────────────────────────

def foot(bbox: list[float]) -> tuple[float, float]:
    """Bottom-center of an (x, y, w, h) bbox — proxy for ground-plane position."""
    x, y, w, h = bbox
    return (x + w / 2, y + h)


def point_in_polygon(p: tuple[float, float], pts: list[list[float]]) -> bool:
    px, py = p
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i][0], pts[i][1]
        xj, yj = pts[j][0], pts[j][1]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def segments_intersect(p1, p2, p3, p4) -> bool:
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)


def crossing_direction(prev, curr, a, b) -> str:
    ax, ay = a
    bx, by = b
    def side(p):
        return (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)
    sp, sc = side(prev), side(curr)
    if sp < 0 < sc:
        return "a_to_b"
    if sc < 0 < sp:
        return "b_to_a"
    return "any"


def bbox_overlap_ratio(a: list[float], b: list[float]) -> float:
    """Intersection area ÷ smaller bbox area."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    smaller = min(max(aw * ah, 1e-6), max(bw * bh, 1e-6))
    return inter / smaller


def bbox_aspect_ratio(bbox: list[float]) -> float:
    """Height / width. > 1 means tall (standing), < 1 means wide (lying)."""
    _, _, w, h = bbox
    return h / max(w, 1e-6)


def bbox_distance(a: list[float], b: list[float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return math.hypot((ax + aw / 2) - (bx + bw / 2), (ay + ah / 2) - (by + bh / 2))


def in_time_window(now_ts: float, window: str | None) -> bool:
    if not window:
        return True
    try:
        start_s, end_s = window.split("-")
        sh, sm = (int(x) for x in start_s.split(":"))
        eh, em = (int(x) for x in end_s.split(":"))
    except Exception:
        return True
    now_local = datetime.datetime.fromtimestamp(now_ts)
    now_min = now_local.hour * 60 + now_local.minute
    start = sh * 60 + sm
    end   = eh * 60 + em
    if start == end:
        return False
    if start < end:
        return start <= now_min < end
    return now_min >= start or now_min < end


def velocity_from_history(hist) -> tuple[float, float, float]:
    if len(hist) < 2:
        return 0.0, 0.0, 0.0
    t0, x0, y0 = hist[0]
    t1, x1, y1 = hist[-1]
    dt = max(t1 - t0, 1e-6)
    vx = (x1 - x0) / dt
    vy = (y1 - y0) / dt
    return vx, vy, math.hypot(vx, vy)


# ── Homography helpers (for speed_enforcement) ─────────────────────────────

def zone_homography(zone: dict) -> tuple[np.ndarray, float, float] | None:
    """If the zone has `use_homography=True`, a 4-vertex polygon, and a real
    `ground_w_m`/`ground_h_m`, return (H, w_m, h_m) where H projects image
    pixels onto ground coordinates in meters. Otherwise None."""
    if not zone.get("use_homography"):
        return None
    pts = zone.get("points") or []
    if len(pts) != 4:
        return None
    w_m = zone.get("ground_w_m")
    h_m = zone.get("ground_h_m")
    if not w_m or not h_m or float(w_m) <= 0 or float(h_m) <= 0:
        return None
    try:
        src = np.array(pts, dtype=np.float32)
        dst = np.array(
            [[0, 0], [w_m, 0], [w_m, h_m], [0, h_m]],
            dtype=np.float32,
        )
        return cv2.getPerspectiveTransform(src, dst), float(w_m), float(h_m)
    except Exception:
        return None


def project_to_ground(matrix: np.ndarray, x: float, y: float) -> tuple[float, float]:
    pt = np.array([[[x, y]]], dtype=np.float32)
    out = cv2.perspectiveTransform(pt, matrix)
    return float(out[0][0][0]), float(out[0][0][1])


def displacement_over_window(history: deque, window_s: float) -> float:
    """Total foot displacement within the last `window_s` of a (ts, x, y)
    history. Used by unsafe_exit to decide if a vehicle is parked."""
    if len(history) < 2:
        return 0.0
    last = history[-1]
    samples = [h for h in history if last[0] - h[0] <= window_s]
    if len(samples) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(samples)):
        total += math.hypot(samples[i][1] - samples[i - 1][1],
                             samples[i][2] - samples[i - 1][2])
    return total


# ── Evaluator ───────────────────────────────────────────────────────────────

class ModuleEvaluator:
    def __init__(self) -> None:
        # Track liveness for hysteresis.
        self.last_seen_ts: dict[tuple[str, int], float]      = {}

        # Per-rule per-track dwell / trajectory state. Kept across brief
        # track-loss windows; pruned by _gc once last_seen_ts ages out.
        self.first_seen:        dict[tuple[str, int], float] = {}
        self.last_pos:          dict[tuple[str, int], tuple[float, float]] = {}
        self.history:           dict[tuple[str, int], deque] = {}

        # idle_vehicle
        self.anchor:            dict[tuple[str, int], tuple[float, float]] = {}

        # speed_enforcement debounce
        self.over_speed_count:  dict[tuple[str, int], int]   = {}
        self.under_speed_count: dict[tuple[str, int], int]   = {}
        self.is_speeding:       set[tuple[str, int]]         = set()

        # lone_worker
        self.first_alone_ts:    dict[tuple[str, int], float] = {}

        # unsafe_exit
        self.was_inside_vehicle: dict[tuple[str, int], int | None] = {}
        self.was_inside_class:   dict[tuple[str, int], str | None] = {}
        self.inside_streak:      dict[tuple[str, int], int]        = {}
        self.last_exit_alert:    dict[tuple[str, int], float]      = {}
        # Vehicle trajectories observed by an unsafe_exit rule. Keyed by the
        # rule id alone so all of the rule's vehicle tracks share a dict;
        # each entry is keyed by (rule_id, vehicle_track_id).
        self.vehicle_history:    dict[tuple[str, int], deque]      = {}

        # trip_fall
        self.fall_bbox_history:  dict[tuple[str, int], deque] = {}
        self.fall_pose_history:  dict[tuple[str, int], deque] = {}
        self.collapsed_since:    dict[tuple[str, int], float] = {}
        self.last_fall_alert:    dict[tuple[str, int], float] = {}

        # wrong_way polygon-variant cooldown — keyed by (mid, tid, zone_id)
        self.last_wrong_way_poly: dict[tuple, float]          = {}

        # Lifecycle layer. Event key = (rule_id, track_id, zone_id_or_empty,
        # sub_label_or_empty). open_events tracks one "currently firing" alert
        # per key.
        self.open_events: dict[tuple, dict] = {}

    def reset(self) -> None:
        """Drop every per-track state dict. Call after the upstream tracker
        resets (e.g. when a detector's classes change and YOLO's tracker
        renumbers everything)."""
        self.__init__()

    # ── Driver ──────────────────────────────────────────────────────────

    def evaluate(
        self,
        config: dict[str, Any] | None,
        detections_by_detector: dict[str, list[dict]],
        now_ts: float,
    ) -> list[dict]:
        if not config:
            return self._expire_all_open(now_ts)

        zones_by_id = {z["id"]: z for z in config.get("zones", [])}
        live_keys: set[tuple[str, int]] = set()
        active: dict[tuple, dict] = {}    # continuous rules → (key, spec)
        one_shots: list[dict]     = []    # transition events

        for mod in (config.get("rules") or []):
            mtype = mod.get("type")
            if mtype not in RULE_TYPES:
                continue
            mid = mod.get("id", "?")
            zids = mod.get("zones", []) or []
            applies_all = "*" in zids
            mzones = [zones_by_id[z] for z in zids if z in zones_by_id]
            polys = [z for z in mzones if z.get("kind") == "polygon"]
            lines = [z for z in mzones if z.get("kind") == "line"]
            det_id = mod.get("detector")
            detections = detections_by_detector.get(det_id, []) if det_id else []

            if mtype == "presence":
                self._eval_presence(mod, mid, detections, polys, applies_all, now_ts, active, live_keys)
            elif mtype == "intrusion":
                self._eval_intrusion(mod, mid, detections, polys, lines, applies_all, now_ts, active, one_shots, live_keys)
            elif mtype == "ppe_compliance":
                self._eval_ppe_compliance(mod, mid, detections, polys, applies_all, now_ts, active, one_shots, live_keys)
            elif mtype == "restricted_zone":
                self._eval_restricted_zone(mod, mid, detections, polys, applies_all, now_ts, active, live_keys)
            elif mtype == "idle_vehicle":
                self._eval_idle_vehicle(mod, mid, detections, polys, applies_all, now_ts, active, live_keys)
            elif mtype == "speed_enforcement":
                self._eval_speed_enforcement(mod, mid, detections, polys, applies_all, now_ts, active, live_keys)
            elif mtype == "wrong_way":
                self._eval_wrong_way(mod, mid, detections, polys, lines, applies_all, now_ts, one_shots, live_keys)
            elif mtype == "lone_worker":
                self._eval_lone_worker(mod, mid, detections_by_detector, polys, applies_all, now_ts, active, live_keys)
            elif mtype == "unsafe_exit":
                self._eval_unsafe_exit(mod, mid, detections_by_detector, polys, applies_all, now_ts, one_shots, live_keys)
            elif mtype == "trip_fall":
                self._eval_trip_fall(mod, mid, detections, polys, applies_all, now_ts, one_shots, live_keys)

        events: list[dict] = list(one_shots)

        # Lifecycle: enter/update for each active key.
        for k, spec in active.items():
            s = self.open_events.get(k)
            if s is None:
                self.open_events[k] = {
                    "started_ts":     now_ts,
                    "last_update_ts": now_ts,
                    "spec":           spec,
                }
                evt = dict(spec)
                evt["phase"] = "enter"
                evt["duration_s"] = 0.0
                events.append(evt)
            else:
                s["spec"] = spec
                if now_ts - s["last_update_ts"] >= LIFECYCLE_UPDATE_INTERVAL_S:
                    s["last_update_ts"] = now_ts
                    evt = dict(spec)
                    evt["phase"] = "update"
                    evt["duration_s"] = round(now_ts - s["started_ts"], 2)
                    events.append(evt)

        # Lifecycle: exits for keys no longer active. Tolerate brief track
        # gaps via hysteresis — if the underlying track is still alive, keep
        # the event open silently.
        for k in list(self.open_events.keys()):
            if k in active:
                continue
            track_key = (k[0], k[1])
            track_alive = (now_ts - self.last_seen_ts.get(track_key, 0.0)) <= TRACK_HYSTERESIS_S
            if track_alive:
                continue
            s = self.open_events.pop(k)
            evt = dict(s["spec"])
            evt["phase"] = "exit"
            evt["duration_s"] = round(now_ts - s["started_ts"], 2)
            events.append(evt)

        self._gc(live_keys, now_ts)
        return events

    def _expire_all_open(self, now_ts: float) -> list[dict]:
        out: list[dict] = []
        for k, s in self.open_events.items():
            evt = dict(s["spec"])
            evt["phase"] = "exit"
            evt["duration_s"] = round(now_ts - s["started_ts"], 2)
            out.append(evt)
        self.open_events.clear()
        return out

    def _gc(self, live_keys: set[tuple[str, int]], now_ts: float) -> None:
        for k in live_keys:
            self.last_seen_ts[k] = now_ts
        for k in list(self.last_seen_ts.keys()):
            if k in live_keys:
                continue
            if now_ts - self.last_seen_ts[k] <= TRACK_HYSTERESIS_S:
                continue
            for d in (
                self.first_seen, self.last_pos, self.history,
                self.anchor, self.over_speed_count, self.under_speed_count,
                self.first_alone_ts,
                self.was_inside_vehicle, self.was_inside_class,
                self.inside_streak, self.last_exit_alert,
                self.fall_bbox_history, self.fall_pose_history,
                self.collapsed_since, self.last_fall_alert,
                self.vehicle_history,
            ):
                d.pop(k, None)
            self.is_speeding.discard(k)
            self.last_seen_ts.pop(k, None)
        # GC composite keys whose track key has aged out.
        for k in list(self.last_wrong_way_poly.keys()):
            if (k[0], k[1]) not in self.last_seen_ts:
                del self.last_wrong_way_poly[k]

    # ── presence ─────────────────────────────────────────────────────────

    def _eval_presence(self, mod, mid, detections, polys, applies_all, now_ts, active, live_keys) -> None:
        classes = mod.get("classes") or []
        min_dur = float(mod.get("min_duration_seconds", 0) or 0)

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            tid = det["track_id"]
            key = (mid, tid)
            live_keys.add(key)

            zone_id = None
            if not applies_all:
                hit = next((z for z in polys if point_in_polygon(foot(det["bbox"]), z["points"])), None)
                if hit is None:
                    continue
                zone_id = hit["id"]

            if key not in self.first_seen:
                self.first_seen[key] = now_ts
            dur = now_ts - self.first_seen[key]
            if dur < min_dur:
                continue
            ek = (mid, tid, zone_id or "", "")
            active[ek] = {
                "module_id":   mid,
                "module_type": "presence",
                "class":       det["class"],
                "track_id":    tid,
                "bbox":        det["bbox"],
                "zone_id":     zone_id,
                "severity":    "warning" if min_dur > 0 else "info",
            }

    # ── intrusion (polygon = continuous, line = one-shot) ────────────────

    def _eval_intrusion(self, mod, mid, detections, polys, lines, applies_all,
                         now_ts, active, one_shots, live_keys) -> None:
        classes = mod.get("classes") or []
        wanted_dir = mod.get("direction", "any")

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            curr = foot(det["bbox"])
            tid = det["track_id"]
            key = (mid, tid)
            live_keys.add(key)

            if applies_all:
                ek = (mid, tid, "", "")
                active[ek] = {
                    "module_id":   mid, "module_type": "intrusion",
                    "class":       det["class"], "track_id": tid,
                    "bbox":        det["bbox"], "severity": "alert",
                }
            else:
                for z in polys:
                    if point_in_polygon(curr, z["points"]):
                        ek = (mid, tid, z["id"], "")
                        active[ek] = {
                            "module_id":   mid, "module_type": "intrusion",
                            "class":       det["class"], "track_id": tid,
                            "bbox":        det["bbox"], "zone_id": z["id"],
                            "severity":    "alert",
                        }

            prev = self.last_pos.get(key)
            self.last_pos[key] = curr
            if prev is None:
                continue
            for z in lines:
                a, b = z["points"][0], z["points"][1]
                if not segments_intersect(prev, curr, a, b):
                    continue
                cd = crossing_direction(prev, curr, a, b)
                if wanted_dir != "any" and wanted_dir != cd:
                    continue
                one_shots.append({
                    "module_id": mid, "module_type": "intrusion",
                    "class":     det["class"], "track_id": tid,
                    "bbox":      det["bbox"], "zone_id": z["id"],
                    "crossing":  cd, "severity": "alert",
                })

    # ── PPE compliance (continuous per missing item, deduped) ────────────

    def _eval_ppe_compliance(self, mod, mid, detections, polys, applies_all,
                              now_ts, active, one_shots, live_keys) -> None:
        required = set(mod.get("required") or [])
        if not required:
            return
        for det in detections:
            missing = PPE_NEGATIVE_TO_POSITIVE.get(det.get("class", ""))
            if missing is None or missing not in required:
                continue
            if not applies_all:
                f = foot(det["bbox"])
                if not any(point_in_polygon(f, z["points"]) for z in polys):
                    continue
            tid = det["track_id"]
            key = (mid, tid)
            live_keys.add(key)
            ek = (mid, tid, "", missing)
            active[ek] = {
                "module_id":   mid, "module_type": "ppe_compliance",
                "class":       det["class"], "missing": missing,
                "track_id":    tid, "bbox": det["bbox"],
                "severity":    "alert",
            }

    # ── restricted_zone ─────────────────────────────────────────────────

    def _eval_restricted_zone(self, mod, mid, detections, polys, applies_all,
                               now_ts, active, live_keys) -> None:
        classes = mod.get("classes") or []
        window = mod.get("active_window") or ""
        if window and not in_time_window(now_ts, window):
            return
        for det in detections:
            if classes and det["class"] not in classes:
                continue
            f = foot(det["bbox"])
            zone_id = None
            if not applies_all:
                hit = next((z for z in polys if point_in_polygon(f, z["points"])), None)
                if hit is None:
                    continue
                zone_id = hit["id"]
            tid = det["track_id"]
            live_keys.add((mid, tid))
            ek = (mid, tid, zone_id or "", "")
            active[ek] = {
                "module_id":     mid, "module_type": "restricted_zone",
                "class":         det["class"], "track_id": tid,
                "bbox":          det["bbox"], "zone_id": zone_id,
                "active_window": window or None,
                "severity":      "alert",
            }

    # ── idle_vehicle ─────────────────────────────────────────────────────

    def _eval_idle_vehicle(self, mod, mid, detections, polys, applies_all,
                            now_ts, active, live_keys) -> None:
        classes = mod.get("classes") or []
        max_disp = float(mod.get("max_displacement_px", 20) or 20)
        min_dur  = float(mod.get("min_duration_seconds", 30) or 30)

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            tid = det["track_id"]
            if tid < 0:
                continue
            f = foot(det["bbox"])
            if not applies_all and not any(point_in_polygon(f, z["points"]) for z in polys):
                continue
            key = (mid, tid)
            live_keys.add(key)

            anchor = self.anchor.get(key)
            if anchor is None:
                self.anchor[key] = f
                self.first_seen[key] = now_ts
                continue
            if math.hypot(f[0] - anchor[0], f[1] - anchor[1]) > max_disp:
                self.anchor[key] = f
                self.first_seen[key] = now_ts
                continue
            dwell = now_ts - self.first_seen.get(key, now_ts)
            if dwell < min_dur:
                continue
            ek = (mid, tid, "", "")
            active[ek] = {
                "module_id":   mid, "module_type": "idle_vehicle",
                "class":       det["class"], "track_id": tid,
                "bbox":        det["bbox"],
                "idle_s":      round(dwell, 2),
                "severity":    "warning",
            }

    # ── speed_enforcement ────────────────────────────────────────────────

    def _eval_speed_enforcement(self, mod, mid, detections, polys, applies_all,
                                 now_ts, active, live_keys) -> None:
        classes = mod.get("classes") or []
        max_speed = float(mod.get("max_speed_m_per_sec", 5) or 5)
        debounce  = int(mod.get("min_consecutive_frames", SPEED_DEBOUNCE_FRAMES) or SPEED_DEBOUNCE_FRAMES)

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            tid = det["track_id"]
            if tid < 0:
                continue
            f = foot(det["bbox"])

            zone = None
            if not applies_all:
                zone = next((z for z in polys if point_in_polygon(f, z["points"])), None)
                if zone is None:
                    continue

            key = (mid, tid)
            live_keys.add(key)
            hist = self.history.setdefault(key, deque(maxlen=8))

            # Prefer homography (4-point perspective) when the zone has it;
            # next prefer flat px/m; finally pixel-only.
            calibration = "none"
            speed_mps: float | None = None
            speed_pxs: float
            if zone is not None:
                homo = zone_homography(zone)
                if homo is not None:
                    M, _, _ = homo
                    gx, gy = project_to_ground(M, f[0], f[1])
                    hist.append((now_ts, gx, gy))
                    _, _, speed_meters = velocity_from_history(hist)
                    speed_mps = speed_meters
                    speed_pxs = float("nan")
                    calibration = "homography"
                else:
                    hist.append((now_ts, f[0], f[1]))
                    _, _, speed_pxs = velocity_from_history(hist)
                    scale = zone.get("scale_px_per_m")
                    if scale and float(scale) > 0:
                        speed_mps = speed_pxs / float(scale)
                        calibration = "scale_px_per_m"
                    else:
                        calibration = "uncalibrated"
            else:
                hist.append((now_ts, f[0], f[1]))
                _, _, speed_pxs = velocity_from_history(hist)
                calibration = "uncalibrated"

            over = speed_mps is not None and speed_mps >= max_speed
            if over:
                self.over_speed_count[key]  = self.over_speed_count.get(key, 0) + 1
                self.under_speed_count[key] = 0
                if self.over_speed_count[key] >= debounce:
                    self.is_speeding.add(key)
            else:
                self.under_speed_count[key] = self.under_speed_count.get(key, 0) + 1
                self.over_speed_count[key]  = 0
                if self.under_speed_count[key] >= debounce:
                    self.is_speeding.discard(key)

            if key in self.is_speeding:
                ek = (mid, tid, (zone or {}).get("id", "") or "", "")
                spec = {
                    "module_id":           mid, "module_type": "speed_enforcement",
                    "class":               det["class"], "track_id": tid,
                    "bbox":                det["bbox"],
                    "speed_m_per_sec":     round(speed_mps, 2) if speed_mps is not None else None,
                    "max_speed_m_per_sec": max_speed,
                    "calibration":         calibration,
                    "zone_id":             (zone or {}).get("id"),
                    "severity":            "alert",
                }
                if calibration == "uncalibrated":
                    spec["speed_px_per_sec"] = round(speed_pxs, 1)
                active[ek] = spec

    # ── wrong_way (line + polygon, one-shots) ────────────────────────────

    def _eval_wrong_way(self, mod, mid, detections, polys, lines, applies_all,
                         now_ts, one_shots, live_keys) -> None:
        classes = mod.get("classes") or []
        allowed_dir = mod.get("allowed_direction", "a_to_b")
        tol_deg = float(mod.get("polygon_tolerance_deg", 45) or 45)

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            tid = det["track_id"]
            if tid < 0:
                continue
            f = foot(det["bbox"])
            key = (mid, tid)
            live_keys.add(key)

            hist = self.history.setdefault(key, deque(maxlen=8))
            hist.append((now_ts, f[0], f[1]))

            prev = self.last_pos.get(key)
            self.last_pos[key] = f
            if prev is not None:
                for z in lines:
                    a, b = z["points"][0], z["points"][1]
                    if not segments_intersect(prev, f, a, b):
                        continue
                    cd = crossing_direction(prev, f, a, b)
                    if cd != "any" and cd != allowed_dir:
                        one_shots.append({
                            "module_id": mid, "module_type": "wrong_way",
                            "class": det["class"], "track_id": tid,
                            "bbox":  det["bbox"], "zone_id": z["id"],
                            "crossing": cd, "allowed_direction": allowed_dir,
                            "severity": "alert",
                        })

            vx, vy, sp = velocity_from_history(hist)
            if sp < 5.0:
                continue
            motion_deg = (math.degrees(math.atan2(vy, vx)) + 360) % 360
            for z in polys:
                allowed = z.get("allowed_direction_deg")
                if allowed is None:
                    continue
                if not point_in_polygon(f, z["points"]):
                    continue
                allowed_deg = float(allowed) % 360
                diff = abs(motion_deg - allowed_deg)
                diff = min(diff, 360 - diff)
                if diff > tol_deg:
                    cool_key = (mid, tid, z["id"])
                    if now_ts - self.last_wrong_way_poly.get(cool_key, float("-inf")) > 3.0:
                        self.last_wrong_way_poly[cool_key] = now_ts
                        one_shots.append({
                            "module_id": mid, "module_type": "wrong_way",
                            "class":     det["class"], "track_id": tid,
                            "bbox":      det["bbox"], "zone_id": z["id"],
                            "motion_deg":  round(motion_deg, 1),
                            "allowed_deg": allowed_deg,
                            "severity":    "alert",
                        })

    # ── lone_worker (continuous) ─────────────────────────────────────────

    def _eval_lone_worker(self, mod, mid, detections_by_detector, polys, applies_all,
                           now_ts, active, live_keys) -> None:
        person_det_id = mod.get("detector")
        detections = detections_by_detector.get(person_det_id, []) if person_det_id else []
        person_class = mod.get("person_class") or "person"
        mode = mod.get("mode") or "zone_bound"
        radius = float(mod.get("isolation_radius_px", 200) or 200)
        min_dur = float(mod.get("min_duration_seconds", 60) or 60)

        # Optional worker filter: only persons overlapped by a `worker_class`
        # detection from `worker_class_detector` are counted. Common use:
        # require a hi-vis vest from the PPE detector so the rule ignores
        # passersby and only tracks actual workers.
        worker_filter = mod.get("worker_filter", "none")
        worker_dets: list[dict] = []
        worker_class = mod.get("worker_class", "vest")
        if worker_filter == "by_class":
            wd_id = mod.get("worker_class_detector")
            if wd_id:
                worker_dets = [d for d in detections_by_detector.get(wd_id, [])
                                if d.get("class") == worker_class]

        def is_worker(person_det: dict) -> bool:
            if worker_filter != "by_class":
                return True
            # Require at least 10% overlap with any worker-class detection.
            # The PPE bbox is typically small (a vest) relative to a full
            # person bbox, so the smaller-area denominator keeps the ratio
            # meaningful.
            return any(bbox_overlap_ratio(person_det["bbox"], wd["bbox"]) > 0.1
                        for wd in worker_dets)

        persons = [d for d in detections if d["class"] == person_class and is_worker(d)]
        feet    = [foot(d["bbox"]) for d in persons]

        for i, det in enumerate(persons):
            tid = det["track_id"]
            if tid < 0:
                continue
            my_foot = feet[i]

            if applies_all:
                containing = polys
                in_scope = True
            else:
                containing = [z for z in polys if point_in_polygon(my_foot, z["points"])]
                in_scope = bool(containing)
            if not in_scope:
                continue

            if mode in ("zone_bound", "both"):
                others_in_zone = sum(
                    1 for j in range(len(persons))
                    if j != i and any(point_in_polygon(feet[j], z["points"]) for z in containing)
                )
                zone_alone = (others_in_zone == 0)
            else:
                zone_alone = True

            if mode in ("isolation_distance", "both"):
                dist_alone = all(
                    math.hypot(my_foot[0] - feet[j][0], my_foot[1] - feet[j][1]) > radius
                    for j in range(len(persons)) if j != i
                )
            else:
                dist_alone = True

            alone = zone_alone and dist_alone
            key = (mid, tid)
            live_keys.add(key)

            if alone:
                first = self.first_alone_ts.get(key)
                if first is None:
                    self.first_alone_ts[key] = now_ts
                    continue
                dur = now_ts - first
                if dur < min_dur:
                    continue
                ek = (mid, tid, "", "")
                active[ek] = {
                    "module_id":   mid, "module_type": "lone_worker",
                    "class":       person_class, "track_id": tid,
                    "bbox":        det["bbox"],
                    "alone_s":     round(dur, 2),
                    "mode":        mode,
                    "severity":    "warning",
                }
            else:
                self.first_alone_ts.pop(key, None)

    # ── unsafe_exit (one-shot) ───────────────────────────────────────────

    def _eval_unsafe_exit(self, mod, mid, detections_by_detector, polys, applies_all,
                           now_ts, one_shots, live_keys) -> None:
        veh_det_id = mod.get("vehicle_detector")
        per_det_id = mod.get("person_detector")
        veh_classes = set(mod.get("vehicle_classes") or [])
        person_class = mod.get("person_class") or "person"
        min_overlap = float(mod.get("min_overlap_ratio", 0.5) or 0.5)

        if not (veh_det_id and per_det_id):
            return

        vehicles = [d for d in detections_by_detector.get(veh_det_id, [])
                    if not veh_classes or d["class"] in veh_classes]
        persons  = [d for d in detections_by_detector.get(per_det_id, [])
                    if d["class"] == person_class]

        # Update vehicle trajectories so we can ask "is this vehicle parked?"
        parked: dict[int, bool] = {}
        for v in vehicles:
            v_tid = v.get("track_id", -1)
            if v_tid < 0:
                continue
            v_key = (mid, v_tid)
            live_keys.add(v_key)
            f_v = foot(v["bbox"])
            h = self.vehicle_history.setdefault(v_key, deque(maxlen=12))
            h.append((now_ts, f_v[0], f_v[1]))
            parked[v_tid] = displacement_over_window(h, 1.0) < UNSAFE_EXIT_PARKED_PX

        for det in persons:
            tid = det["track_id"]
            if tid < 0:
                continue
            f = foot(det["bbox"])
            if not applies_all and not any(point_in_polygon(f, z["points"]) for z in polys):
                continue
            key = (mid, tid)
            live_keys.add(key)

            best_overlap = 0.0
            best_vehicle = None
            for v in vehicles:
                ov = bbox_overlap_ratio(det["bbox"], v["bbox"])
                if ov > best_overlap:
                    best_overlap = ov
                    best_vehicle = v

            currently_inside = best_overlap >= min_overlap
            streak = self.inside_streak.get(key, 0)
            if currently_inside:
                streak += 1
            else:
                streak = 0
            self.inside_streak[key] = streak

            was_inside = self.was_inside_vehicle.get(key)
            if streak >= UNSAFE_EXIT_INSIDE_FRAMES and best_vehicle is not None:
                self.was_inside_vehicle[key] = best_vehicle["track_id"]
                self.was_inside_class[key]   = best_vehicle["class"]
            elif streak == 0 and was_inside is not None:
                # Only flag if the vehicle the person came from was parked,
                # so normal pull-up-and-drop-off in a parking lot doesn't fire.
                was_parked = parked.get(was_inside, True)
                if not was_parked:
                    self.was_inside_vehicle.pop(key, None)
                    self.was_inside_class.pop(key, None)
                    continue
                if now_ts - self.last_exit_alert.get(key, float("-inf")) > 3.0:
                    self.last_exit_alert[key] = now_ts
                    one_shots.append({
                        "module_id":        mid, "module_type": "unsafe_exit",
                        "class":            person_class, "track_id": tid,
                        "bbox":             det["bbox"],
                        "vehicle_track_id": was_inside,
                        "vehicle_class":    self.was_inside_class.get(key),
                        "vehicle_parked":   was_parked,
                        "severity":         "alert",
                    })
                self.was_inside_vehicle.pop(key, None)
                self.was_inside_class.pop(key, None)

    # ── trip_fall (one-shot, both modes use sustained-down confirmation) ─

    def _eval_trip_fall(self, mod, mid, detections, polys, applies_all,
                         now_ts, one_shots, live_keys) -> None:
        mode = mod.get("mode") or "bbox_heuristic"
        cooldown = float(mod.get("cooldown_seconds", 5) or 5)

        for det in detections:
            if det.get("class") != "person":
                continue
            tid = det["track_id"]
            if tid < 0:
                continue
            f = foot(det["bbox"])
            if not applies_all and not any(point_in_polygon(f, z["points"]) for z in polys):
                continue
            key = (mid, tid)
            live_keys.add(key)
            if now_ts - self.last_fall_alert.get(key, float("-inf")) < cooldown:
                continue

            if mode == "bbox_heuristic":
                self._fall_check_bbox(key, det, now_ts, mode, one_shots)
            elif mode == "pose":
                self._fall_check_pose(key, det, now_ts, mode, one_shots)

    def _fall_check_bbox(self, key, det, now_ts, mode, one_shots) -> None:
        ar = bbox_aspect_ratio(det["bbox"])
        f = foot(det["bbox"])
        hist = self.fall_bbox_history.setdefault(key, deque(maxlen=20))
        hist.append((now_ts, ar, f[1]))
        window = [s for s in hist if now_ts - s[0] <= 1.5]
        if len(window) < 3:
            return
        half = max(1, len(window) // 2)
        early_ars = [s[1] for s in window[:half]]
        late_ars  = [s[1] for s in window[half:]]
        fys       = [s[2] for s in window]
        collapsed = (
            max(early_ars) >= 1.5
            and min(late_ars) <= 0.7
            and (max(fys) - min(fys)) >= 30
            and fys[-1] > fys[0]
        )
        currently_down = ar <= 0.9
        self._update_collapse(key, collapsed, currently_down, now_ts, det, mode, one_shots,
                              extras={"aspect_ratio": round(ar, 2)})

    def _fall_check_pose(self, key, det, now_ts, mode, one_shots) -> None:
        kps = det.get("keypoints")
        if not kps or len(kps) < 17:
            return
        # COCO order: nose=0, l_shoulder=5, r_shoulder=6, l_hip=11, r_hip=12,
        # l_ankle=15, r_ankle=16. Need at least the torso + ankle keypoints
        # confident to call a fall.
        needed = [kps[i] for i in (0, 5, 6, 11, 12, 15, 16)]
        if any(p[2] < 0.3 for p in needed):
            return
        nose = kps[0]
        ls, rs = kps[5], kps[6]
        lh, rh = kps[11], kps[12]
        la, ra = kps[15], kps[16]
        shoulder_mid = ((ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2)
        hip_mid      = ((lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2)
        torso_angle  = math.degrees(math.atan2(
            abs(hip_mid[0] - shoulder_mid[0]),
            abs(hip_mid[1] - shoulder_mid[1]) + 1e-6,
        ))
        ankles_y     = max(la[1], ra[1])
        vertical_span = abs(ankles_y - nose[1])

        hist = self.fall_pose_history.setdefault(key, deque(maxlen=20))
        hist.append((now_ts, torso_angle, vertical_span))
        window = [s for s in hist if now_ts - s[0] <= 1.5]
        if len(window) < 3:
            return
        # Collapse if: torso angle crossed from < 30° early → > 60° late, AND
        # vertical span dropped to less than 60% of its early peak. The second
        # check distinguishes a fall from someone bending forward to pick
        # something up (torso tips but span stays similar).
        half = max(1, len(window) // 2)
        early_angles = [s[1] for s in window[:half]]
        late_angles  = [s[1] for s in window[half:]]
        early_span   = max(s[2] for s in window[:half])
        late_span    = min(s[2] for s in window[half:])
        collapsed = (
            min(early_angles) < 30
            and max(late_angles) > 60
            and (early_span <= 1e-3 or late_span / early_span <= 0.6)
        )
        currently_down = torso_angle > 55
        self._update_collapse(key, collapsed, currently_down, now_ts, det, mode, one_shots,
                              extras={"torso_angle_deg": round(torso_angle, 1),
                                       "vertical_span": round(vertical_span, 1)})

    def _update_collapse(self, key, collapsed, currently_down, now_ts, det, mode,
                          one_shots, extras: dict) -> None:
        if collapsed and key not in self.collapsed_since:
            self.collapsed_since[key] = now_ts
        if key in self.collapsed_since:
            if not currently_down:
                # Person stood back up — wasn't a fall, clear the watch.
                self.collapsed_since.pop(key, None)
                return
            elapsed = now_ts - self.collapsed_since[key]
            if elapsed >= FALL_SUSTAINED_S:
                self.last_fall_alert[key] = now_ts
                self.collapsed_since.pop(key, None)
                evt = {
                    "module_id":   key[0], "module_type": "trip_fall",
                    "class":       "person", "track_id": key[1],
                    "bbox":        det["bbox"], "mode": mode,
                    "severity":    "alert",
                }
                evt.update(extras)
                one_shots.append(evt)
