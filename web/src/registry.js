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

export const MIN_CONF_PARAM = {
  kind: "number", default: 0.5, min: 0.05, max: 0.95, step: 0.05, label: "Min conf",
};

export const DETECTOR_TYPES = {
  object_detection: {
    label: "Object detection",
    sublabel: "COCO 80-class",
    color: "cyan",
    params: {
      model: {
        kind: "select",
        options: [
          { value: "yolov8n", label: "YOLOv8n · fastest" },
          { value: "yolov8s", label: "YOLOv8s · balanced" },
          { value: "yolov8m", label: "YOLOv8m · accurate" },
          { value: "yolov8l", label: "YOLOv8l · heavy" },
        ],
        default: "yolov8s",
        label: "Model",
      },
      classes: { kind: "multi", options: OBJECT_CLASSES,
                 default: ["person", "bicycle", "car", "motorcycle", "bus", "truck"], label: "Classes" },
      min_conf: MIN_CONF_PARAM,
    },
  },
  ppe_detection: {
    label: "PPE detection",
    sublabel: "hafizqaim / yolov8-ppe",
    color: "lime",
    params: {
      model:    { kind: "text",  default: "models/ppe.pt", label: "Model path" },
      classes:  { kind: "multi", options: PPE_DETECTOR_CLASSES,
                  default: [...PPE_DETECTOR_CLASSES], label: "Classes" },
      min_conf: MIN_CONF_PARAM,
    },
  },
};

export const RULE_TYPES = {
  intrusion: {
    label: "Zone intrusion",
    sublabel: "containment + line crossing",
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
    label: "Object presence",
    sublabel: "with optional dwell",
    color: "cyan",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      classes:  { kind: "multi", source: "detector_classes", default: ["person", "car"], label: "Classes" },
      min_duration_seconds: { kind: "number", default: 0, min: 0, max: 3600, step: 1, label: "Min duration (s)" },
    },
    defaultZones: ["*"],
  },
  ppe_compliance: {
    label: "PPE compliance",
    sublabel: "required gear check",
    color: "lime",
    params: {
      detector: { kind: "detector_ref", default: null, label: "Detector" },
      required: { kind: "multi", options: PPE_REQUIRED_ITEMS, default: ["head_helmet"], label: "Required PPE" },
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

// Resolve a rule's `classes` (or PPE `required`) options dynamically from
// the assigned detector — a rule can only consume what its detector emits.
export function effectiveOptions(p, mod, modules) {
  if (p.source === "detector_classes") {
    const det = modules.find((m) => m.id === mod.params?.detector);
    if (det && isDetector(det.type) && Array.isArray(det.params.classes)) {
      return det.params.classes;
    }
    return [];
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
