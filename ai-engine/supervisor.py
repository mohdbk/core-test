"""Supervisor — owns one InferenceEngine per camera.

Polls the DB on a short interval and reconciles the live engine set with
what's persisted: spawns a worker for every new camera, stops one when its
camera row is deleted. Each engine handles its own enable/disable + idle
logic internally (see InferenceEngine), so the supervisor doesn't need to
know about those — it only cares about row lifecycle.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import db
from inference import InferenceEngine

log = logging.getLogger("ai-engine.supervisor")


class Supervisor:
    SYNC_INTERVAL_SEC = 3.0

    def __init__(self) -> None:
        self.engines: dict[str, InferenceEngine] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue | None = None
        self._sync_task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def attach(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self._loop = loop
        self._queue = queue

    async def start(self) -> None:
        await self.sync()
        self._sync_task = asyncio.create_task(self._sync_loop(), name="supervisor-sync")

    async def _sync_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.SYNC_INTERVAL_SEC)
                return
            except asyncio.TimeoutError:
                pass
            try:
                await self.sync()
            except Exception:
                log.exception("supervisor sync failed")

    async def sync(self) -> None:
        """Bring the live engines into agreement with the DB.

        Camera row appeared → spawn an engine.
        Camera row gone     → stop and forget the engine.
        Enable/disable      → handled inside the engine itself by reading
                              the config each iteration. No restart needed.
        """
        # DB calls are blocking — keep the event loop snappy.
        cameras: list[dict] = await asyncio.to_thread(db.list_cameras)
        wanted_ids = {c["id"] for c in cameras}
        current_ids = set(self.engines.keys())

        # Stop engines for cameras that no longer exist.
        for cid in current_ids - wanted_ids:
            log.info("supervisor: stopping engine for removed camera %s", cid)
            await asyncio.to_thread(self.engines[cid].stop)
            del self.engines[cid]

        # Start engines for new cameras.
        for cid in wanted_ids - current_ids:
            log.info("supervisor: starting engine for camera %s", cid)
            engine = InferenceEngine(camera_id=cid)
            if self._loop and self._queue:
                engine.attach(self._loop, self._queue)
            engine.start()
            self.engines[cid] = engine

    async def stop(self) -> None:
        self._stop.set()
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except (asyncio.CancelledError, Exception):
                pass
        for cid, engine in list(self.engines.items()):
            await asyncio.to_thread(engine.stop)
        self.engines.clear()

    def status(self) -> dict[str, Any]:
        return {cid: dict(eng.status) for cid, eng in self.engines.items()}
