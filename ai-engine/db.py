"""SQLite layer for ai-engine.

One table for now: `cameras`. Camera-level fields live as columns; the
annotation tree (zones + modules) is stored as a JSON blob so its shape can
evolve without schema migrations. The API hides this split — callers see
`zones` and `modules` as top-level fields.
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
  id            TEXT PRIMARY KEY,            -- UUID
  name          TEXT NOT NULL,
  source        TEXT NOT NULL,
  image_width   INTEGER,
  image_height  INTEGER,
  config_json   TEXT NOT NULL DEFAULT '{"zones":[],"detectors":[],"rules":[]}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Forward-only schema migrations applied on every boot. Each is idempotent
# — duplicate-add and missing-drop errors are caught in init().
MIGRATIONS: list[str] = [
    "ALTER TABLE cameras ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE cameras DROP COLUMN whep_url",
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
                # Both directions of column ALTER are idempotent: re-adding a
                # column or dropping one that's already gone is a no-op.
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


def _row_to_camera(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    cfg = json.loads(row["config_json"])
    return {
        "id":           row["id"],
        "name":         row["name"],
        "source":       row["source"],
        "image_width":  row["image_width"],
        "image_height": row["image_height"],
        "enabled":      bool(row["enabled"]),
        "zones":        cfg.get("zones",     []),
        "detectors":    cfg.get("detectors", []),
        "rules":        cfg.get("rules",     []),
        "created_at":   row["created_at"],
        "updated_at":   row["updated_at"],
    }


def _row_to_summary(row: sqlite3.Row) -> dict:
    cfg = json.loads(row["config_json"])
    return {
        "id":             row["id"],
        "name":           row["name"],
        "source":         row["source"],
        "image_width":    row["image_width"],
        "image_height":   row["image_height"],
        "enabled":        bool(row["enabled"]),
        "zone_count":     len(cfg.get("zones",     [])),
        "detector_count": len(cfg.get("detectors", [])),
        "rule_count":     len(cfg.get("rules",     [])),
        "created_at":     row["created_at"],
        "updated_at":     row["updated_at"],
    }


def list_cameras() -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM cameras ORDER BY created_at"
        ).fetchall()
        return [_row_to_summary(r) for r in rows]


def get_camera(camera_id: str) -> dict | None:
    with connect() as c:
        row = c.execute(
            "SELECT * FROM cameras WHERE id = ?", (camera_id,)
        ).fetchone()
        return _row_to_camera(row)


def create_camera(data: dict[str, Any]) -> dict | None:
    cam_id = data.get("id") or str(uuid.uuid4())
    config = {
        "zones":     data.get("zones",     []),
        "detectors": data.get("detectors", []),
        "rules":     data.get("rules",     []),
    }
    with connect() as c:
        c.execute(
            "INSERT INTO cameras "
            "(id, name, source, image_width, image_height, "
            " config_json, enabled) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                cam_id,
                data.get("name", "Untitled"),
                data["source"],
                data.get("image_width"),
                data.get("image_height"),
                json.dumps(config),
                1 if data.get("enabled", True) else 0,
            ),
        )
    return get_camera(cam_id)


def update_camera(camera_id: str, data: dict[str, Any]) -> dict | None:
    """Partial update — only the keys present in `data` are written."""
    with connect() as c:
        row = c.execute(
            "SELECT * FROM cameras WHERE id = ?", (camera_id,)
        ).fetchone()
        if row is None:
            return None

        cfg = json.loads(row["config_json"])
        if "zones"     in data: cfg["zones"]     = data["zones"]
        if "detectors" in data: cfg["detectors"] = data["detectors"]
        if "rules"     in data: cfg["rules"]     = data["rules"]

        enabled_in = data.get("enabled")
        enabled = row["enabled"] if enabled_in is None else (1 if enabled_in else 0)

        c.execute(
            "UPDATE cameras SET "
            "  name=?, source=?, "
            "  image_width=?, image_height=?, "
            "  config_json=?, enabled=?, "
            "  updated_at=datetime('now') "
            "WHERE id=?",
            (
                data.get("name",         row["name"]),
                data.get("source",       row["source"]),
                data.get("image_width",  row["image_width"]),
                data.get("image_height", row["image_height"]),
                json.dumps(cfg),
                enabled,
                camera_id,
            ),
        )
    return get_camera(camera_id)


def delete_camera(camera_id: str) -> bool:
    with connect() as c:
        cur = c.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        return cur.rowcount > 0


def ensure_default() -> None:
    """Bootstrap a demo camera on first boot. The id is a fresh UUID — every
    camera in the system is UUID-keyed; `name` is the human handle."""
    with connect() as c:
        cnt = c.execute("SELECT COUNT(*) AS n FROM cameras").fetchone()["n"]
    if cnt > 0:
        return
    create_camera({
        "name":         "Demo camera",
        "source":       "rtsp://176.107.35.230:554/live/ch00_0",
        "image_width":  1280,
        "image_height": 720,
    })
