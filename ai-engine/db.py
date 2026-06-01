"""SQLite layer for ai-engine.

Normalized schema:

  cameras    — top-level metadata (name, source, resolution, enabled).
  models     — inference models (built-in or user-registered).
  zones      — drawn regions belonging to one camera.
  detectors  — inference modules (one per camera, referencing a model).
  rules      — safety rules (one per camera, referencing a detector).

`zones`, `detectors`, and `rules` were originally stored as one JSON blob
inside `cameras.config_json`. A one-shot migration on boot explodes the
blob into rows and bumps `cameras.schema_version` from 0 → 1; subsequent
reads come from the tables. The composed-dict shape returned by
`get_camera()` is intentionally unchanged so the rest of the engine + the
frontend stay decoupled from this storage detail.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

log = logging.getLogger("ai-engine.db")

DB_PATH = Path(
    os.environ.get(
        "AI_ENGINE_DB",
        str(Path(__file__).resolve().parent / "data" / "camera.db"),
    )
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS cameras (
  id              TEXT PRIMARY KEY,            -- UUID
  name            TEXT NOT NULL,
  source          TEXT NOT NULL,
  image_width     INTEGER,
  image_height    INTEGER,
  config_json     TEXT NOT NULL DEFAULT '{}',  -- legacy; emptied after migration
  enabled         INTEGER NOT NULL DEFAULT 1,
  schema_version  INTEGER NOT NULL DEFAULT 0,  -- 0 = blob, 1 = normalized tables
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL,                 -- "object" | "ppe" | "pose"
  weights_path  TEXT NOT NULL,
  classes_json  TEXT NOT NULL DEFAULT '[]',
  builtin       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zones (
  id                     TEXT PRIMARY KEY,
  camera_id              TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL,        -- "polygon" | "line"
  color                  TEXT,
  points_json            TEXT NOT NULL DEFAULT '[]',
  scale_px_per_m         REAL,
  allowed_direction_deg  REAL,
  use_homography         INTEGER NOT NULL DEFAULT 0,
  ground_w_m             REAL,
  ground_h_m             REAL,
  order_index            INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_zones_camera ON zones(camera_id, order_index);

CREATE TABLE IF NOT EXISTS detectors (
  id           TEXT PRIMARY KEY,
  camera_id    TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                  -- "object_detection" | "ppe_detection" | "pose_detection"
  params_json  TEXT NOT NULL DEFAULT '{}',
  order_index  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_detectors_camera ON detectors(camera_id, order_index);

CREATE TABLE IF NOT EXISTS rules (
  id           TEXT PRIMARY KEY,
  camera_id    TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  params_json  TEXT NOT NULL DEFAULT '{}',
  zones_json   TEXT NOT NULL DEFAULT '[]',     -- list of zone IDs or ["*"]
  order_index  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_camera ON rules(camera_id, order_index);
"""

MIGRATIONS: list[str] = [
    "ALTER TABLE cameras ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE cameras DROP COLUMN whep_url",
    "ALTER TABLE cameras ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE zones ADD COLUMN use_homography INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE zones ADD COLUMN ground_w_m REAL",
    "ALTER TABLE zones ADD COLUMN ground_h_m REAL",
]


# ── Class-list constants used to seed built-in models ───────────────────────

_COCO_80 = [
    "person", "bicycle", "car", "motorcycle", "airplane",
    "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe",
    "backpack", "umbrella", "handbag", "tie", "suitcase",
    "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl",
    "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
    "hot dog", "pizza", "donut", "cake",
    "chair", "couch", "potted plant", "bed", "dining table", "toilet",
    "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator",
    "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]

_PPE_CLASSES = [
    "head_helmet", "head_nohelmet",
    "face_mask",   "face_nomask",
    "hand_glove",  "hand_noglove",
    "glasses",     "No_Glasses",
    "Ear-protection", "No_Ear-Protection",
    "boots", "Barefoots", "Sandals", "shoes",
    "Harness", "vest", "person",
]

BUILTIN_MODELS: list[dict] = [
    {
        "id":           "builtin-yolov8n",
        "name":         "General Detector · Fast",
        "description":  "YOLOv8n on COCO 80 classes. Smallest weights, lowest latency.",
        "kind":         "object",
        "weights_path": "models/yolov8n.pt",
        "classes":      _COCO_80,
    },
    {
        "id":           "builtin-yolov8s",
        "name":         "General Detector · Balanced",
        "description":  "YOLOv8s on COCO 80 classes. Recommended default for most cameras.",
        "kind":         "object",
        "weights_path": "models/yolov8s.pt",
        "classes":      _COCO_80,
    },
    {
        "id":           "builtin-yolov8m",
        "name":         "General Detector · Accurate",
        "description":  "YOLOv8m on COCO 80 classes. Higher accuracy, ~3× slower than Fast.",
        "kind":         "object",
        "weights_path": "models/yolov8m.pt",
        "classes":      _COCO_80,
    },
    {
        "id":           "builtin-ppe",
        "name":         "Workspace Safety (PPE)",
        "description":  "Detects 17 personal-protective-equipment classes — helmets, masks, gloves, boots, harnesses, vests.",
        "kind":         "ppe",
        "weights_path": "models/ppe.pt",
        "classes":      _PPE_CLASSES,
    },
    {
        "id":           "builtin-yolov8s-pose",
        "name":         "Human Pose Estimation",
        "description":  "YOLOv8s-Pose with 17 keypoints per person. Required for the pose mode of trip & fall detection.",
        "kind":         "pose",
        "weights_path": "models/yolov8s-pose.pt",
        "classes":      ["person"],
    },
]


def init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript(SCHEMA)
        for stmt in MIGRATIONS:
            try:
                c.execute(stmt)
            except sqlite3.OperationalError as e:
                msg = str(e)
                if "duplicate column name" in msg or "no such column" in msg:
                    continue
                raise


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ── Row→dict converters ─────────────────────────────────────────────────────

def _row_to_zone(z: sqlite3.Row) -> dict:
    return {
        "id":                    z["id"],
        "name":                  z["name"],
        "kind":                  z["kind"],
        "color":                 z["color"],
        "points":                json.loads(z["points_json"] or "[]"),
        "scale_px_per_m":        z["scale_px_per_m"],
        "allowed_direction_deg": z["allowed_direction_deg"],
        "use_homography":        bool(z["use_homography"]),
        "ground_w_m":            z["ground_w_m"],
        "ground_h_m":            z["ground_h_m"],
    }


def _row_to_detector(d: sqlite3.Row) -> dict:
    out = {"id": d["id"], "type": d["type"]}
    out.update(json.loads(d["params_json"] or "{}"))
    return out


def _row_to_rule(r: sqlite3.Row) -> dict:
    out = {"id": r["id"], "type": r["type"]}
    out.update(json.loads(r["params_json"] or "{}"))
    out["zones"] = json.loads(r["zones_json"] or "[]")
    return out


def _row_to_summary(row: sqlite3.Row, conn: sqlite3.Connection) -> dict:
    cid = row["id"]
    z = conn.execute("SELECT COUNT(*) AS n FROM zones     WHERE camera_id=?", (cid,)).fetchone()["n"]
    d = conn.execute("SELECT COUNT(*) AS n FROM detectors WHERE camera_id=?", (cid,)).fetchone()["n"]
    r = conn.execute("SELECT COUNT(*) AS n FROM rules     WHERE camera_id=?", (cid,)).fetchone()["n"]
    return {
        "id":             row["id"],
        "name":           row["name"],
        "source":         row["source"],
        "image_width":    row["image_width"],
        "image_height":   row["image_height"],
        "enabled":        bool(row["enabled"]),
        "zone_count":     z,
        "detector_count": d,
        "rule_count":     r,
        "created_at":     row["created_at"],
        "updated_at":     row["updated_at"],
    }


def _row_to_model(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id":           row["id"],
        "name":         row["name"],
        "description":  row["description"],
        "kind":         row["kind"],
        "weights_path": row["weights_path"],
        "classes":      json.loads(row["classes_json"] or "[]"),
        "builtin":      bool(row["builtin"]),
        "created_at":   row["created_at"],
        "updated_at":   row["updated_at"],
    }


# ── Writers used by the bulk-update path ───────────────────────────────────

def _replace_zones(c: sqlite3.Connection, camera_id: str, items: list[dict]) -> None:
    c.execute("DELETE FROM zones WHERE camera_id = ?", (camera_id,))
    for i, z in enumerate(items):
        c.execute(
            "INSERT INTO zones "
            "(id, camera_id, name, kind, color, points_json, "
            " scale_px_per_m, allowed_direction_deg, "
            " use_homography, ground_w_m, ground_h_m, order_index) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                z.get("id") or str(uuid.uuid4()),
                camera_id,
                z.get("name", "zone"),
                z.get("kind", "polygon"),
                z.get("color"),
                json.dumps(z.get("points", [])),
                z.get("scale_px_per_m"),
                z.get("allowed_direction_deg"),
                1 if z.get("use_homography") else 0,
                z.get("ground_w_m"),
                z.get("ground_h_m"),
                i,
            ),
        )


def _replace_detectors(c: sqlite3.Connection, camera_id: str, items: list[dict]) -> None:
    c.execute("DELETE FROM detectors WHERE camera_id = ?", (camera_id,))
    for i, d in enumerate(items):
        params = {k: v for k, v in d.items() if k not in ("id", "type")}
        c.execute(
            "INSERT INTO detectors (id, camera_id, type, params_json, order_index) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                d.get("id") or str(uuid.uuid4()),
                camera_id,
                d["type"],
                json.dumps(params),
                i,
            ),
        )


def _replace_rules(c: sqlite3.Connection, camera_id: str, items: list[dict]) -> None:
    c.execute("DELETE FROM rules WHERE camera_id = ?", (camera_id,))
    for i, r in enumerate(items):
        params = {k: v for k, v in r.items() if k not in ("id", "type", "zones")}
        c.execute(
            "INSERT INTO rules (id, camera_id, type, params_json, zones_json, order_index) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                r.get("id") or str(uuid.uuid4()),
                camera_id,
                r["type"],
                json.dumps(params),
                json.dumps(r.get("zones", [])),
                i,
            ),
        )


def _migrate_blob_to_tables() -> None:
    """One-shot per camera. Cameras at schema_version=0 have their
    config_json blob exploded into the normalized tables, then config_json
    is emptied and schema_version bumped to 1. Idempotent."""
    with connect() as c:
        rows = c.execute(
            "SELECT id, config_json FROM cameras WHERE schema_version = 0"
        ).fetchall()
        for r in rows:
            cfg = {}
            try:
                cfg = json.loads(r["config_json"] or "{}")
            except json.JSONDecodeError:
                log.warning("camera %s has malformed config_json — skipping migration", r["id"])
            cam_id = r["id"]
            _replace_zones(c,     cam_id, cfg.get("zones",     []))
            _replace_detectors(c, cam_id, cfg.get("detectors", []))
            _replace_rules(c,     cam_id, cfg.get("rules",     []))
            c.execute(
                "UPDATE cameras SET schema_version = 1, config_json = '{}' WHERE id = ?",
                (cam_id,),
            )
            log.info("migrated camera %s to normalized tables", cam_id)


# ── Cameras ─────────────────────────────────────────────────────────────────

def list_cameras() -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM cameras ORDER BY created_at"
        ).fetchall()
        return [_row_to_summary(r, c) for r in rows]


def get_camera_updated_at(camera_id: str) -> str | None:
    """Cheap one-row probe for the hot path in inference.py — read this
    each frame, only refetch the full tree when the timestamp changes."""
    with connect() as c:
        row = c.execute(
            "SELECT updated_at FROM cameras WHERE id = ?", (camera_id,)
        ).fetchone()
        return row["updated_at"] if row else None


def get_camera(camera_id: str) -> dict | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM cameras WHERE id = ?", (camera_id,)
        ).fetchone()
        if row is None:
            return None
        zones = c.execute(
            "SELECT * FROM zones WHERE camera_id = ? ORDER BY order_index",
            (camera_id,),
        ).fetchall()
        detectors = c.execute(
            "SELECT * FROM detectors WHERE camera_id = ? ORDER BY order_index",
            (camera_id,),
        ).fetchall()
        rules = c.execute(
            "SELECT * FROM rules WHERE camera_id = ? ORDER BY order_index",
            (camera_id,),
        ).fetchall()
        return {
            "id":           row["id"],
            "name":         row["name"],
            "source":       row["source"],
            "image_width":  row["image_width"],
            "image_height": row["image_height"],
            "enabled":      bool(row["enabled"]),
            "zones":        [_row_to_zone(z)     for z in zones],
            "detectors":    [_row_to_detector(d) for d in detectors],
            "rules":        [_row_to_rule(r)     for r in rules],
            "created_at":   row["created_at"],
            "updated_at":   row["updated_at"],
        }


def create_camera(data: dict[str, Any]) -> dict | None:
    cam_id = data.get("id") or str(uuid.uuid4())
    with connect() as c:
        c.execute(
            "INSERT INTO cameras "
            "(id, name, source, image_width, image_height, "
            " config_json, enabled, schema_version) "
            "VALUES (?, ?, ?, ?, ?, '{}', ?, 1)",
            (
                cam_id,
                data.get("name", "Untitled"),
                data["source"],
                data.get("image_width"),
                data.get("image_height"),
                1 if data.get("enabled", True) else 0,
            ),
        )
        _replace_zones(c,     cam_id, data.get("zones",     []))
        _replace_detectors(c, cam_id, data.get("detectors", []))
        _replace_rules(c,     cam_id, data.get("rules",     []))
    return get_camera(cam_id)


def update_camera(camera_id: str, data: dict[str, Any]) -> dict | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM cameras WHERE id = ?", (camera_id,)
        ).fetchone()
        if row is None:
            return None

        enabled_in = data.get("enabled")
        enabled = row["enabled"] if enabled_in is None else (1 if enabled_in else 0)

        c.execute(
            "UPDATE cameras SET "
            "  name=?, source=?, "
            "  image_width=?, image_height=?, "
            "  enabled=?, updated_at=datetime('now') "
            "WHERE id=?",
            (
                data.get("name",         row["name"]),
                data.get("source",       row["source"]),
                data.get("image_width",  row["image_width"]),
                data.get("image_height", row["image_height"]),
                enabled,
                camera_id,
            ),
        )

        if "zones"     in data: _replace_zones(c,     camera_id, data["zones"])
        if "detectors" in data: _replace_detectors(c, camera_id, data["detectors"])
        if "rules"     in data: _replace_rules(c,     camera_id, data["rules"])
    return get_camera(camera_id)


def delete_camera(camera_id: str) -> bool:
    with connect() as c:
        cur = c.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        return cur.rowcount > 0


def ensure_default() -> None:
    """Bootstrap: seed built-in models, migrate any legacy blob cameras to
    normalized tables, and create a demo camera if the table is empty."""
    with connect() as c:
        existing = {r["id"] for r in c.execute("SELECT id FROM models").fetchall()}
        for spec in BUILTIN_MODELS:
            if spec["id"] in existing:
                continue
            c.execute(
                "INSERT INTO models "
                "(id, name, description, kind, weights_path, classes_json, builtin) "
                "VALUES (?, ?, ?, ?, ?, ?, 1)",
                (
                    spec["id"], spec["name"], spec["description"],
                    spec["kind"], spec["weights_path"],
                    json.dumps(spec["classes"]),
                ),
            )

    _migrate_blob_to_tables()

    with connect() as c:
        cnt = c.execute("SELECT COUNT(*) AS n FROM cameras").fetchone()["n"]
    if cnt == 0:
        create_camera({
            "name":         "Demo camera",
            "source":       "rtsp://176.107.35.230:554/live/ch00_0",
            "image_width":  1280,
            "image_height": 720,
        })


# ── Models ──────────────────────────────────────────────────────────────────

def list_models() -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM models ORDER BY builtin DESC, kind, name"
        ).fetchall()
        return [_row_to_model(r) for r in rows]


def get_model(model_id: str) -> dict | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM models WHERE id = ?", (model_id,)
        ).fetchone()
        return _row_to_model(row)


def create_model(data: dict[str, Any]) -> dict | None:
    mid = data.get("id") or str(uuid.uuid4())
    with connect() as c:
        c.execute(
            "INSERT INTO models "
            "(id, name, description, kind, weights_path, classes_json, builtin) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            (
                mid,
                data.get("name", "Untitled model"),
                data.get("description", ""),
                data["kind"],
                data["weights_path"],
                json.dumps(data.get("classes", [])),
            ),
        )
    return get_model(mid)


def update_model(model_id: str, data: dict[str, Any]) -> dict | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM models WHERE id = ?", (model_id,)
        ).fetchone()
        if row is None:
            return None
        is_builtin = bool(row["builtin"])
        classes_in = data.get("classes")
        c.execute(
            "UPDATE models SET "
            "  name=?, description=?, kind=?, weights_path=?, classes_json=?, "
            "  updated_at=datetime('now') "
            "WHERE id=?",
            (
                data.get("name",        row["name"]),
                data.get("description", row["description"]),
                row["kind"]         if is_builtin else data.get("kind",         row["kind"]),
                row["weights_path"] if is_builtin else data.get("weights_path", row["weights_path"]),
                json.dumps(classes_in) if classes_in is not None else row["classes_json"],
                model_id,
            ),
        )
    return get_model(model_id)


def delete_model(model_id: str) -> bool:
    with connect() as c:
        row = c.execute("SELECT builtin FROM models WHERE id = ?", (model_id,)).fetchone()
        if row is None:
            return False
        if bool(row["builtin"]):
            raise ValueError("cannot delete a built-in model")
        cur = c.execute("DELETE FROM models WHERE id = ?", (model_id,))
        return cur.rowcount > 0
