"""Module evaluators — rules consume detections from detectors.

The pipeline is now a small DAG: detector modules produce per-detector streams
of detections, and rule modules declare which detector they consume (the
`detector` field). The engine runs all detectors per frame, then calls
`ModuleEvaluator.evaluate(config, detections_by_detector, now_ts)` here.

That makes:
- **Confidence** a property of the detector, not the rule.
- **PPE / face / pose** simple to add: just new detector types pointing at
  the appropriate model.
- **Multi-model per camera** natural (e.g., object_detection + ppe_detection
  on the same frames, feeding different rules).
"""

from __future__ import annotations

from typing import Any


# Module taxonomy. Anything in DETECTOR_TYPES is run by the engine to produce
# detections; anything in RULE_TYPES is run here against a detector's stream.
DETECTOR_TYPES: set[str] = {"object_detection", "ppe_detection"}
RULE_TYPES:     set[str] = {"intrusion", "presence", "ppe_compliance"}

# PPE absence-class map: detection class → the positive item it implies is
# MISSING. Tuned for hafizqaim/yolov8-ppe (17-class workspace safety model).
# Add more pairs (or load this from a config file) when integrating other
# PPE models that use a different naming convention.
PPE_NEGATIVE_TO_POSITIVE: dict[str, str] = {
    "head_nohelmet":     "head_helmet",
    "face_nomask":       "face_mask",
    "hand_noglove":      "hand_glove",
    "No_Glasses":        "glasses",
    "No_Ear-Protection": "Ear-protection",
    "Barefoots":         "boots",
    "Sandals":           "boots",   # wrong footwear ≈ no proper boots
}


# ── Geometry helpers ────────────────────────────────────────────────────────

def foot(bbox: list[float]) -> tuple[float, float]:
    """Bottom-center of an (x, y, w, h) bbox — a better proxy for an object's
    ground-plane position than the geometric center."""
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


# ── Evaluator ───────────────────────────────────────────────────────────────

class ModuleEvaluator:
    def __init__(self) -> None:
        # (rule_id, track_id) → first-seen timestamp (for dwell)
        self.first_seen: dict[tuple[str, int], float] = {}
        # (rule_id, track_id) → previous foot position (for line crossings)
        self.last_pos: dict[tuple[str, int], tuple[float, float]] = {}

    def evaluate(
        self,
        config: dict[str, Any] | None,
        detections_by_detector: dict[str, list[dict]],
        now_ts: float,
    ) -> list[dict]:
        events: list[dict] = []
        if not config:
            return events

        zones_by_id = {z["id"]: z for z in config.get("zones", [])}
        seen_keys: set[tuple[str, int]] = set()

        for mod in (config.get("rules") or []):
            mtype = mod.get("type")
            if mtype not in RULE_TYPES:
                continue

            det_id = mod.get("detector")
            detections = detections_by_detector.get(det_id, []) if det_id else []

            mid = mod.get("id", "?")
            zids = mod.get("zones", []) or []
            applies_all = "*" in zids
            mzones = [zones_by_id[z] for z in zids if z in zones_by_id]
            polys = [z for z in mzones if z.get("kind") == "polygon"]
            lines = [z for z in mzones if z.get("kind") == "line"]

            if mtype == "presence":
                events += self._eval_presence(mod, mid, detections, polys, applies_all, now_ts, seen_keys)
            elif mtype == "intrusion":
                events += self._eval_intrusion(mod, mid, detections, polys, lines, applies_all)
            elif mtype == "ppe_compliance":
                events += self._eval_ppe_compliance(mod, mid, detections, polys, applies_all)

        # GC dwell state for tracks no longer in scope this frame.
        for key in list(self.first_seen.keys()):
            if key not in seen_keys:
                del self.first_seen[key]

        return events

    # ── presence ─────────────────────────────────────────────────────────

    def _eval_presence(self, mod, mid, detections, polys, applies_all, now_ts, seen_keys) -> list[dict]:
        out: list[dict] = []
        classes = mod.get("classes") or []   # empty = accept all classes the detector emits
        min_dur = float(mod.get("min_duration_seconds", 0) or 0)

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            zone_id = None
            if not applies_all:
                hit = next((z for z in polys if point_in_polygon(foot(det["bbox"]), z["points"])), None)
                if hit is None:
                    continue
                zone_id = hit["id"]

            key = (mid, det["track_id"])
            seen_keys.add(key)
            if key not in self.first_seen:
                self.first_seen[key] = now_ts
            dur = now_ts - self.first_seen[key]
            if dur >= min_dur:
                out.append({
                    "module_id": mid,
                    "module_type": "presence",
                    "class": det["class"],
                    "track_id": det["track_id"],
                    "bbox": det["bbox"],
                    "duration_s": round(dur, 2),
                    "zone_id": zone_id,
                    "severity": "warning" if min_dur > 0 else "info",
                })
        return out

    # ── PPE compliance ───────────────────────────────────────────────────
    # Strategy: the PPE model emits "absence" classes directly (head_nohelmet,
    # Barefoots, …). For each such detection, if its positive counterpart is
    # in the rule's `required` list, emit an alert. Zones still filter by
    # foot-point as elsewhere.

    def _eval_ppe_compliance(self, mod, mid, detections, polys, applies_all) -> list[dict]:
        out: list[dict] = []
        required = set(mod.get("required") or [])
        if not required:
            return out

        for det in detections:
            missing = PPE_NEGATIVE_TO_POSITIVE.get(det.get("class", ""))
            if missing is None or missing not in required:
                continue
            if not applies_all:
                f = foot(det["bbox"])
                if not any(point_in_polygon(f, z["points"]) for z in polys):
                    continue
            out.append({
                "module_id": mid,
                "module_type": "ppe_compliance",
                "class": det["class"],
                "missing": missing,
                "track_id": det["track_id"],
                "bbox": det["bbox"],
                "severity": "alert",
            })
        return out

    # ── intrusion ─────────────────────────────────────────────────────────

    def _eval_intrusion(self, mod, mid, detections, polys, lines, applies_all) -> list[dict]:
        out: list[dict] = []
        classes = mod.get("classes") or []   # empty = accept all
        wanted_dir = mod.get("direction", "any")

        for det in detections:
            if classes and det["class"] not in classes:
                continue
            curr = foot(det["bbox"])
            track_id = det["track_id"]
            key = (mid, track_id)

            # Polygon zones: presence inside the polygon = intrusion.
            if applies_all:
                out.append({
                    "module_id": mid,
                    "module_type": "intrusion",
                    "class": det["class"],
                    "track_id": track_id,
                    "bbox": det["bbox"],
                    "severity": "alert",
                })
            else:
                for z in polys:
                    if point_in_polygon(curr, z["points"]):
                        out.append({
                            "module_id": mid,
                            "module_type": "intrusion",
                            "class": det["class"],
                            "track_id": track_id,
                            "bbox": det["bbox"],
                            "zone_id": z["id"],
                            "severity": "alert",
                        })

            # Line zones: crossing detection — needs the previous frame's pos.
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
                out.append({
                    "module_id": mid,
                    "module_type": "intrusion",
                    "class": det["class"],
                    "track_id": track_id,
                    "bbox": det["bbox"],
                    "zone_id": z["id"],
                    "crossing": cd,
                    "severity": "alert",
                })

        return out
