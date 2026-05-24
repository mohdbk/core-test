import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
  DETECTOR_TYPES, RULE_TYPES, getSpec, isDetector, isRule, makeDefaultParams, newUuid,
} from "../registry.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => typeof s === "string" && UUID_RE.test(s);

// Load + own the full config (zones + detectors + rules) for one camera, and
// auto-save (debounced) whenever the local state changes. Migrates any
// non-UUID ids to UUIDs on the first load and pushes the result back.
export function useCamera(cameraId) {
  const [camera, setCamera]   = useState(null);   // metadata (name, source, enabled, …)
  const [zones, setZones]     = useState([]);
  const [modules, setModules] = useState([]);     // flat list, detectors + rules
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | loading | saving | saved | error | offline

  const suspendRef = useRef(true);     // block autosave during initial load
  const lastSavedRef = useRef("");
  const timerRef     = useRef(null);

  // ── Load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraId) return;
    let cancelled = false;
    suspendRef.current = true;
    setSaveStatus("loading");
    (async () => {
      try {
        const cam = await api.getCamera(cameraId);
        if (cancelled) return;
        const { camera: cm, zones: zs, modules: ms, migrationNeeded } = hydrate(cam);
        setCamera(cm);
        setZones(zs);
        setModules(ms);
        // Build a snapshot of "what we'd send right now" so the autosave
        // doesn't fire spuriously on this initial state.
        lastSavedRef.current = JSON.stringify(toPayload(zs, ms, cm));
        setSaveStatus(migrationNeeded ? "migrating" : "saved");
        suspendRef.current = false;
        if (migrationNeeded) scheduleSave();    // push the migrated shape
      } catch (e) {
        if (!cancelled) setSaveStatus("offline");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  // ── Autosave ────────────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (suspendRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveStatus("pending");
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      const body = toPayload(zones, modules, camera);
      const json = JSON.stringify(body);
      if (json === lastSavedRef.current) {
        setSaveStatus("saved");
        return;
      }
      setSaveStatus("saving");
      try {
        await api.updateCamera(cameraId, body);
        lastSavedRef.current = json;
        setSaveStatus("saved");
      } catch (e) {
        setSaveStatus("error");
      }
    }, 500);
  }, [cameraId, zones, modules, camera]);

  useEffect(() => {
    if (suspendRef.current) return;
    scheduleSave();
  }, [zones, modules, camera, scheduleSave]);

  // ── Mutations ───────────────────────────────────────────────────────
  const addZone     = (z) => setZones((zs) => [...zs, z]);
  const updateZone  = (id, patch) =>
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const removeZone  = (id) => {
    setZones((zs) => zs.filter((z) => z.id !== id));
    setModules((ms) =>
      ms.map((m) => ({ ...m, zones: (m.zones || []).filter((zid) => zid !== id) })),
    );
  };

  const addDetector = (type) => {
    const spec = DETECTOR_TYPES[type];
    if (!spec) return;
    setModules((ms) => [
      ...ms,
      { id: newUuid(), type, params: makeDefaultParams(spec), zones: [] },
    ]);
  };

  const addRule = (type) => {
    const spec = RULE_TYPES[type];
    if (!spec) return;
    setModules((ms) => {
      const params = makeDefaultParams(spec);
      const firstDet = ms.find((m) => isDetector(m.type));
      if (firstDet && params.detector === null) params.detector = firstDet.id;
      return [...ms, { id: newUuid(), type, params, zones: [...spec.defaultZones] }];
    });
  };

  const updateModule = (id, patch) =>
    setModules((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const removeModule = (id) => {
    setModules((ms) => {
      const removed = ms.find((m) => m.id === id);
      let next = ms.filter((m) => m.id !== id);
      if (removed && isDetector(removed.type)) {
        // Null out any rule that pointed at this detector.
        next = next.map((m) =>
          isRule(m.type) && m.params.detector === id
            ? { ...m, params: { ...m.params, detector: null } }
            : m,
        );
      }
      return next;
    });
  };

  const setEnabled = async (enabled) => {
    setCamera((c) => ({ ...c, enabled }));
    try { await api.updateCamera(cameraId, { enabled }); } catch {}
  };

  return {
    camera, zones, modules,
    addZone, updateZone, removeZone,
    addDetector, addRule, updateModule, removeModule,
    setEnabled,
    saveStatus,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function hydrate(cam) {
  let migrationNeeded = false;
  const idRemap = {};

  const zones = (cam.zones || []).map((z, i) => {
    let id = z.id;
    if (!isUuid(id)) { const fresh = newUuid(); idRemap[id] = fresh; id = fresh; migrationNeeded = true; }
    return {
      id,
      name: z.name,
      kind: z.kind,
      // Use the stored color when present; otherwise pick from the palette
      // by index so existing un-colored zones still get a distinct accent.
      color: z.color || zonePalette[i % zonePalette.length],
      editing: false,
      points: (z.points || []).map((pt) =>
        Array.isArray(pt) ? { x: pt[0], y: pt[1] } : { x: pt.x, y: pt.y },
      ),
    };
  });

  const loadModule = (m, into) => {
    const spec = getSpec(m.type);
    if (!spec) return;
    let id = m.id;
    if (!isUuid(id)) { const fresh = newUuid(); idRemap[id] = fresh; id = fresh; migrationNeeded = true; }
    const params = {};
    for (const [k, p] of Object.entries(spec.params)) {
      if (m[k] !== undefined) params[k] = Array.isArray(m[k]) ? [...m[k]] : m[k];
      else params[k] = p.kind === "multi" ? [...p.default] : p.default;
    }
    const remappedZones = (m.zones || []).map((zid) => idRemap[zid] || zid);
    into.push({ id, type: m.type, params, zones: remappedZones });
  };

  const modules = [];
  (cam.detectors || []).forEach((m) => loadModule(m, modules));
  (cam.rules     || []).forEach((m) => loadModule(m, modules));

  // Fix up rule.detector refs after id remap.
  for (const m of modules) {
    if (isRule(m.type) && m.params.detector && idRemap[m.params.detector]) {
      m.params.detector = idRemap[m.params.detector];
      migrationNeeded = true;
    }
  }
  // Auto-create a default detector if any rule is dangling.
  const haveAnyRule   = modules.some((m) => isRule(m.type));
  let firstDetectorId = modules.find((m) => isDetector(m.type))?.id || null;
  if (haveAnyRule && !firstDetectorId) {
    const detModule = {
      id: newUuid(),
      type: "object_detection",
      params: makeDefaultParams(DETECTOR_TYPES.object_detection),
      zones: [],
    };
    modules.unshift(detModule);
    firstDetectorId = detModule.id;
    migrationNeeded = true;
  }
  for (const m of modules) {
    if (isRule(m.type) && !m.params.detector && firstDetectorId) {
      m.params.detector = firstDetectorId;
      migrationNeeded = true;
    }
  }

  const camera = {
    id: cam.id, name: cam.name, source: cam.source,
    image_width: cam.image_width, image_height: cam.image_height,
    enabled: cam.enabled,
  };
  return { camera, zones, modules, migrationNeeded };
}

function toPayload(zones, modules, camera) {
  const buildModule = (m) => {
    const spec = getSpec(m.type);
    const out = { id: m.id, type: m.type };
    if (!spec) return out;
    for (const [k, p] of Object.entries(spec.params)) {
      if (paramApplies(p, m, zones)) out[k] = m.params[k];
    }
    if (isRule(m.type)) out.zones = [...m.zones];
    return out;
  };
  return {
    zones: zones.map((z) => ({
      id: z.id, name: z.name, kind: z.kind, color: z.color,
      points: z.points.map((p) => [Math.round(p.x), Math.round(p.y)]),
    })),
    detectors: modules.filter((m) => isDetector(m.type)).map(buildModule),
    rules:     modules.filter((m) => isRule(m.type)).map(buildModule),
    image_width:  camera?.image_width ?? null,
    image_height: camera?.image_height ?? null,
  };
}

function paramApplies(p, mod, zones) {
  if (!p.requires) return true;
  if (p.requires.zoneKind) {
    return (mod.zones || []).some((zid) => zones.find((z) => z.id === zid)?.kind === p.requires.zoneKind);
  }
  return true;
}

export const zonePalette = [
  "#22d3ee", "#06b6d4", "#60a5fa", "#a78bfa",
  "#c084fc", "#f472b6", "#fb7185", "#f59e0b",
  "#fbbf24", "#a3e635", "#34d399", "#ef4444",
];
