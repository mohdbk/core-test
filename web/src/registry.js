// Module-type registry — single source of truth for what detectors and rules
// the system knows about, what params each takes, and how they render. Mirror
// of ai-engine/modules.py's DETECTOR_TYPES / RULE_TYPES.

export const PPE_DETECTOR_CLASSES = [
  "head_helmet", "head_nohelmet",
  "face_mask",   "face_nomask",
  "hand_glove",  "hand_noglove",
  "glasses",     "No_Glasses",
  "Ear-protection", "No_Ear-Protection",
  "boots", "Barefoots", "Sandals", "shoes",
  "Harness", "vest", "person",
];
export const PPE_REQUIRED_ITEMS = [
  "head_helmet", "face_mask", "hand_glove",
  "glasses", "Ear-protection", "boots",
];

// Full COCO class list, same order as ai-engine/modules.py:COCO_TO_NAME.
export const OBJECT_CLASSES = [
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
];

export const VEHICLE_CLASSES = ["car", "truck", "bus", "motorcycle"];

export const MIN_CONF_PARAM = {
  kind: "number", default: 0.5, min: 0.05, max: 0.95, step: 0.05, label: "Min conf",
};

// Detector types now reference models via `model_id` instead of hard-coding
// weight paths. Each detector type binds to one model `kind` (object / ppe /
// pose); the model dropdown is populated from /api/models filtered by that
// kind. Class chips are derived from the selected model's class list.
export const DETECTOR_TYPES = {
  object_detection: {
    label: "Object Detection",
    sublabel: "COCO · 80 classes",
    color: "cyan",
    modelKind: "object",
    params: {
      model_id: { kind: "model_ref", forKind: "object", default: null, label: "Model" },
      classes:  { kind: "multi", source: "model_classes",
                  default: ["person", "bicycle", "car", "motorcycle", "bus", "truck"], label: "Classes" },
      min_conf: MIN_CONF_PARAM,
    },
  },
  ppe_detection: {
    label: "PPE Detection",
    sublabel: "Personal Protective Equipment",
    color: "lime",
    modelKind: "ppe",
    params: {
      model_id: { kind: "model_ref", forKind: "ppe", default: null, label: "Model" },
      classes:  { kind: "multi", source: "model_classes",
                  default: [...PPE_DETECTOR_CLASSES], label: "Classes" },
      min_conf: MIN_CONF_PARAM,
    },
  },
  pose_detection: {
    label: "Pose Estimation",
    sublabel: "17 keypoints per person",
    color: "violet",
    modelKind: "pose",
    params: {
      model_id: { kind: "model_ref", forKind: "pose", default: null, label: "Model" },
      classes:  { kind: "multi", source: "model_classes", default: ["person"], label: "Classes" },
      min_conf: MIN_CONF_PARAM,
    },
  },
};

export const RULE_TYPES = {
  intrusion: {
    label: "Intrusion",
    sublabel: "Containment & line crossing",
    color: "rose",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      classes:  { kind: "multi", source: "detector_classes", default: ["person"], label: "Classes" },
      direction: {
        kind: "select",
        options: [
          { value: "any",    label: "↔ any" },
          { value: "a_to_b", label: "→ A to B" },
          { value: "b_to_a", label: "← B to A" },
        ],
        default: "any", label: "Direction",
        requires: { zoneKind: "line" },
      },
    },
    defaultZones: [],
  },
  presence: {
    label: "Object Presence",
    sublabel: "With optional dwell",
    color: "cyan",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      classes:  { kind: "multi", source: "detector_classes", default: ["person", "car"], label: "Classes" },
      min_duration_seconds: { kind: "number", default: 0, min: 0, max: 3600, step: 1, label: "Min duration (s)" },
    },
    defaultZones: ["*"],
  },
  ppe_compliance: {
    label: "PPE Compliance",
    sublabel: "Required gear check",
    color: "lime",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      required: { kind: "multi", options: PPE_REQUIRED_ITEMS, default: ["head_helmet"], label: "Required PPE" },
    },
    defaultZones: ["*"],
  },

  // ── New safety rules ─────────────────────────────────────────────────

  restricted_zone: {
    label: "Restricted Zone",
    sublabel: "No-go zone with time window",
    color: "rose",
    params: {
      detector:      { kind: "detector_ref", default: null, label: "Detector" },
      classes:       { kind: "multi", source: "detector_classes", default: ["person"], label: "Classes" },
      active_window: { kind: "text", default: "", label: "Active window (HH:MM-HH:MM)" },
    },
    defaultZones: [],
  },

  idle_vehicle: {
    label: "Idle Vehicle",
    sublabel: "Stopped track & low displacement",
    color: "amber",
    params: {
      detector:             { kind: "detector_ref", default: null, label: "Detector" },
      classes:              { kind: "multi", source: "detector_classes", default: [...VEHICLE_CLASSES], label: "Vehicle classes" },
      max_displacement_px:  { kind: "number", default: 20, min: 1, max: 500, step: 1, label: "Max displacement (px)" },
      min_duration_seconds: { kind: "number", default: 30, min: 1, max: 3600, step: 1, label: "Min duration (s)" },
    },
    defaultZones: [],
  },

  speed_enforcement: {
    label: "Speed Enforcement",
    sublabel: "Per-zone calibration (px/m or homography)",
    color: "amber",
    params: {
      detector:              { kind: "detector_ref", default: null, label: "Detector" },
      classes:               { kind: "multi", source: "detector_classes", default: [...VEHICLE_CLASSES], label: "Classes" },
      max_speed_m_per_sec:   { kind: "number", default: 5, min: 0.1, max: 100, step: 0.1, label: "Max speed (m/s)" },
      min_consecutive_frames:{ kind: "number", default: 3, min: 1, max: 30, step: 1, label: "Sustain frames" },
    },
    defaultZones: [],
  },

  wrong_way: {
    label: "Wrong-Way Movement",
    sublabel: "Line crossing or polygon direction",
    color: "rose",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      classes:  { kind: "multi", source: "detector_classes", default: [...VEHICLE_CLASSES], label: "Classes" },
      allowed_direction: {
        kind: "select",
        options: [
          { value: "a_to_b", label: "Only → A to B" },
          { value: "b_to_a", label: "Only ← B to A" },
        ],
        default: "a_to_b", label: "Allowed direction (line)",
        requires: { zoneKind: "line" },
      },
      polygon_tolerance_deg: { kind: "number", default: 45, min: 5, max: 180, step: 5, label: "Polygon angle tolerance (°)" },
    },
    defaultZones: [],
  },

  lone_worker: {
    label: "Lone Worker",
    sublabel: "Zone count & isolation distance",
    color: "amber",
    params: {
      detector:     { kind: "detector_ref", default: null, label: "Person detector" },
      person_class: { kind: "text", default: "person", label: "Person class" },
      mode: {
        kind: "select",
        options: [
          { value: "zone_bound",          label: "Zone-bound (count == 1)" },
          { value: "isolation_distance",  label: "Isolation distance" },
          { value: "both",                label: "Both" },
        ],
        default: "both", label: "Mode",
      },
      isolation_radius_px:  { kind: "number", default: 200, min: 10, max: 2000, step: 10, label: "Isolation radius (px)" },
      min_duration_seconds: { kind: "number", default: 60, min: 1, max: 3600, step: 1, label: "Min duration (s)" },
      // Optional "is this person a worker?" filter — overlap a `worker_class`
      // detection (typically a hi-vis vest) onto the person bbox before
      // counting them. Eliminates cafeteria-style false positives.
      worker_filter: {
        kind: "select",
        options: [
          { value: "none",     label: "Count every person" },
          { value: "by_class", label: "Require a worker tag (PPE class overlap)" },
        ],
        default: "none", label: "Worker filter",
      },
      worker_class_detector: { kind: "detector_ref", default: null, label: "Worker-tag detector" },
      worker_class:          { kind: "text", default: "vest", label: "Worker-tag class" },
    },
    defaultZones: [],
  },

  unsafe_exit: {
    label: "Unsafe Exit",
    sublabel: "Person dismounts from a stationary vehicle",
    color: "rose",
    params: {
      vehicle_detector:  { kind: "detector_ref", default: null, label: "Vehicle detector" },
      vehicle_classes:   { kind: "multi", source: "detector_classes", from: "vehicle_detector",
                           default: [...VEHICLE_CLASSES], label: "Vehicle classes" },
      person_detector:   { kind: "detector_ref", default: null, label: "Person detector" },
      person_class:      { kind: "text", default: "person", label: "Person class" },
      min_overlap_ratio: { kind: "number", default: 0.3, min: 0.05, max: 1, step: 0.05, label: "Min overlap ratio" },
    },
    defaultZones: ["*"],
  },

  trip_fall: {
    label: "Trip & Fall",
    sublabel: "Bbox heuristic or pose estimation",
    color: "rose",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      mode: {
        kind: "select",
        options: [
          { value: "bbox_heuristic", label: "Bbox heuristic — any object detector" },
          { value: "pose",           label: "Pose — requires a Pose Estimation detector" },
        ],
        default: "bbox_heuristic", label: "Mode",
      },
      cooldown_seconds: { kind: "number", default: 5, min: 1, max: 60, step: 1, label: "Cooldown (s)" },
    },
    defaultZones: ["*"],
  },
};

export const isDetector = (t) => Object.hasOwn(DETECTOR_TYPES, t);
export const isRule     = (t) => Object.hasOwn(RULE_TYPES, t);
export const getSpec    = (t) => DETECTOR_TYPES[t] || RULE_TYPES[t] || null;

export function newUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function makeDefaultParams(spec) {
  const params = {};
  for (const [k, p] of Object.entries(spec.params)) {
    params[k] = p.kind === "multi" ? [...p.default] : p.default;
  }
  return params;
}

// Resolve a multi-select param's options dynamically:
//
//   source: "detector_classes" — a rule's `classes` come from the chosen
//     detector's `classes` (which itself was narrowed from the model). `from`
//     picks which detector-ref param to read; defaults to `detector`.
//
//   source: "model_classes" — a detector's `classes` come from the chosen
//     model's full class list. Requires the models list to resolve.
//
// Defaults are static `options: [...]` arrays.
export function effectiveOptions(p, mod, modules, models = []) {
  if (p.source === "detector_classes") {
    const ref = p.from || "detector";
    const det = modules.find((m) => m.id === mod.params?.[ref]);
    if (det && isDetector(det.type) && Array.isArray(det.params.classes)) {
      return det.params.classes;
    }
    return [];
  }
  if (p.source === "model_classes") {
    const mid = mod.params?.model_id;
    if (!mid) return [];
    const m = models.find((mm) => mm.id === mid);
    return m?.classes || [];
  }
  return p.options || [];
}

export function paramApplies(p, mod, zones) {
  if (!p.requires) return true;
  if (p.requires.zoneKind) {
    return (mod.zones || []).some((zid) => zones.find((z) => z.id === zid)?.kind === p.requires.zoneKind);
  }
  return true;
}
