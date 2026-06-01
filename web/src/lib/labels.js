// Centralised display-label dictionary. Internal identifiers stay
// snake_case in code (matches the backend keys), but anything user-facing
// goes through these helpers so we always show "Trip & Fall" rather than
// "trip_fall" or "Missing Helmet" rather than "missing head_helmet".

const RULE_LABELS = {
  intrusion:         "Intrusion",
  presence:          "Presence",
  ppe_compliance:    "PPE Compliance",
  restricted_zone:   "Restricted Zone",
  idle_vehicle:      "Idle Vehicle",
  speed_enforcement: "Speed Enforcement",
  wrong_way:         "Wrong-Way Movement",
  lone_worker:       "Lone Worker",
  unsafe_exit:       "Unsafe Exit",
  trip_fall:         "Trip & Fall",
};

const DETECTOR_LABELS = {
  object_detection: "Object Detection",
  ppe_detection:    "PPE Detection",
  pose_detection:   "Pose Estimation",
};

// Friendly names for PPE classes (positive + negative variants).
const PPE_LABELS = {
  head_helmet:        "Helmet",
  head_nohelmet:      "No Helmet",
  face_mask:          "Face Mask",
  face_nomask:        "No Face Mask",
  hand_glove:         "Gloves",
  hand_noglove:       "No Gloves",
  glasses:            "Safety Glasses",
  No_Glasses:         "No Safety Glasses",
  "Ear-protection":   "Ear Protection",
  "No_Ear-Protection":"No Ear Protection",
  boots:              "Boots",
  Barefoots:          "Barefoot",
  Sandals:            "Sandals",
  shoes:              "Shoes",
  Harness:            "Harness",
  vest:               "Hi-Vis Vest",
  person:             "Person",
};

const CROSSING_LABELS = {
  a_to_b: "A → B",
  b_to_a: "B → A",
  any:    "Any direction",
};

const MODE_LABELS = {
  bbox_heuristic:     "Bbox Heuristic",
  pose:               "Pose",
  zone_bound:         "Zone-bound",
  isolation_distance: "Isolation Distance",
  both:               "Zone + Distance",
  by_class:           "By Class Tag",
  none:               "No Filter",
};

const SEVERITY_LABELS = {
  alert:   "Alert",
  warning: "Warning",
  info:    "Info",
};

// Fallback for unknown identifiers — splits on _ / - / camelCase boundaries
// and Title-Cases each word.
export function titleCase(s) {
  if (s == null) return "";
  return String(s)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export const ruleLabel     = (k) => RULE_LABELS[k]     || titleCase(k);
export const detectorLabel = (k) => DETECTOR_LABELS[k] || titleCase(k);
export const ppeLabel      = (k) => PPE_LABELS[k]      || titleCase(k);
export const classLabel    = (k) => PPE_LABELS[k]      || titleCase(k);
export const crossingLabel = (k) => CROSSING_LABELS[k] || titleCase(k);
export const modeLabel     = (k) => MODE_LABELS[k]     || titleCase(k);
export const severityLabel = (k) => SEVERITY_LABELS[k] || titleCase(k);
// Generic helper for any module type (rule OR detector).
export const moduleTypeLabel = (k) => RULE_LABELS[k] || DETECTOR_LABELS[k] || titleCase(k);
