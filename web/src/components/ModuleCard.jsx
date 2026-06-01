import {
  Activity, AlertTriangle, ArrowLeftRight, Ban, Box, Eye, Gauge, HardHat,
  Layers, LogOut, PauseCircle, Shield, ShieldAlert, Sparkles, Target, Trash2, UserCheck,
} from "lucide-react";
import {
  DETECTOR_TYPES, RULE_TYPES, effectiveOptions, getSpec, isDetector, isRule, paramApplies,
} from "../registry.js";
import { classLabel } from "../lib/labels.js";
import IconButton from "./IconButton.jsx";

// Iconography by module type.
const TYPE_ICON = {
  // detectors
  object_detection: Box,
  ppe_detection:    HardHat,
  pose_detection:   Sparkles,
  // original rules
  intrusion:        ShieldAlert,
  presence:         Eye,
  ppe_compliance:   Shield,
  // new safety rules
  restricted_zone:  Ban,
  idle_vehicle:     PauseCircle,
  speed_enforcement: Gauge,
  wrong_way:        ArrowLeftRight,
  lone_worker:      UserCheck,
  unsafe_exit:      LogOut,
  trip_fall:        AlertTriangle,
};
const COLOR_RING = {
  cyan:   "from-cyan-400/30 to-cyan-500/10  text-cyan-400  border-cyan-400/30",
  violet: "from-violet-400/30 to-violet-500/10 text-violet-400 border-violet-400/30",
  rose:   "from-rose-400/30 to-rose-500/10  text-rose-400  border-rose-400/30",
  lime:   "from-lime-400/30 to-lime-500/10  text-lime-400  border-lime-400/30",
};

export default function ModuleCard({ module, modules, zones, models = [], onUpdate, onRemove }) {
  const spec = getSpec(module.type);
  if (!spec) return null;
  const color = spec.color || "cyan";
  const Icon = TYPE_ICON[module.type] || Activity;

  function setParam(key, value) {
    onUpdate(module.id, { params: { ...module.params, [key]: value } });
  }
  function toggleChip(key, val, isMulti = true) {
    const arr = module.params[key] || [];
    if (!isMulti) { setParam(key, val); return; }
    const i = arr.indexOf(val);
    const next = i >= 0 ? arr.filter((x) => x !== val) : [...arr, val];
    setParam(key, next);
  }
  function toggleZone(val) {
    let z = module.zones || [];
    if (val === "*") {
      z = z.includes("*") ? [] : ["*"];
    } else {
      z = z.filter((x) => x !== "*");
      z = z.includes(val) ? z.filter((x) => x !== val) : [...z, val];
    }
    onUpdate(module.id, { zones: z });
  }

  const detectors = modules.filter((m) => isDetector(m.type));

  return (
    <div className="rounded-lg border border-white/[.07] bg-black/20 p-3 space-y-3 hover:border-white/[.12] transition-colors">
      <header className="flex items-start gap-2.5">
        <div className={`w-7 h-7 grid place-items-center rounded-md border bg-gradient-to-br ${COLOR_RING[color]}`}>
          <Icon size={14} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text leading-snug">{spec.label}</div>
          <div className="font-mono text-[10px] text-subtle truncate leading-snug">
            {String(module.id).split("-")[0]}…
            {spec.sublabel && <> · {spec.sublabel}</>}
          </div>
        </div>
        <IconButton
          icon={Trash2}
          label="Delete"
          variant="danger"
          size="xs"
          onClick={() => onRemove(module.id)}
        />
      </header>

      <div className="space-y-2.5">
        {Object.entries(spec.params).map(([key, p]) => {
          if (!paramApplies(p, module, zones)) return null;
          return (
            <ParamField
              key={key}
              paramKey={key}
              paramSpec={p}
              value={module.params[key]}
              modules={modules}
              detectors={detectors}
              models={models}
              onMultiToggle={(val) => toggleChip(key, val, true)}
              onValue={(val) => setParam(key, val)}
              module={module}
            />
          );
        })}

        {isRule(module.type) && (
          <div className="space-y-1.5">
            <div className="label flex items-center gap-1">
              <Target size={10} strokeWidth={2.25} />
              Zones
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => toggleZone("*")}
                className={`chip ${(module.zones || []).includes("*") ? "chip-on" : ""}`}
                title="Apply rule to the whole frame"
              >
                <Layers size={10} className="mr-1" />
                whole frame
              </button>
              {zones.map((z) => (
                <button
                  key={z.id}
                  onClick={() => toggleZone(z.id)}
                  title={z.id}
                  className={`chip ${(module.zones || []).includes(z.id) ? "chip-on" : ""}`}
                >
                  {z.name}
                  {z.kind === "line" && <span className="ml-1 opacity-70">line</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ParamField({ paramKey, paramSpec, value, modules, detectors, models, onMultiToggle, onValue, module }) {
  const p = paramSpec;

  if (p.kind === "multi") {
    const opts = effectiveOptions(p, module, modules, models);
    const ref = p.from || "detector";
    let hint = null;
    if (p.source === "detector_classes") {
      if (!module.params[ref]) hint = `assign a ${ref.replace(/_/g, " ")} to see options`;
      else if (opts.length === 0) hint = "detector has no classes selected";
    } else if (p.source === "model_classes") {
      if (!module.params.model_id) hint = "assign a model to see options";
      else if (opts.length === 0) hint = "model has no classes registered";
    }
    return (
      <div className="space-y-1.5">
        <div className="label">{p.label}</div>
        <div className="flex flex-wrap gap-1.5">
          {opts.map((opt) => (
            <button
              key={opt}
              onClick={() => onMultiToggle(opt)}
              title={opt}
              className={`chip ${(value || []).includes(opt) ? "chip-on" : ""}`}
            >
              {classLabel(opt)}
            </button>
          ))}
        </div>
        {hint && (
          <div className="text-[11px] text-amber-400/90 inline-flex items-center gap-1">
            <Activity size={10} strokeWidth={2.25} />
            {hint}
          </div>
        )}
      </div>
    );
  }

  if (p.kind === "number") {
    return (
      <div className="space-y-1.5">
        <div className="label">{p.label}</div>
        <input
          type="number"
          min={p.min} max={p.max} step={p.step}
          value={value ?? p.default}
          onChange={(e) => onValue(Number(e.target.value))}
          className="input font-mono w-32"
        />
      </div>
    );
  }

  if (p.kind === "select") {
    return (
      <div className="space-y-1.5">
        <div className="label">{p.label}</div>
        <select
          value={value ?? p.default}
          onChange={(e) => onValue(e.target.value)}
          className="input font-mono"
        >
          {p.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
          ))}
        </select>
      </div>
    );
  }

  if (p.kind === "text") {
    return (
      <div className="space-y-1.5">
        <div className="label">{p.label}</div>
        <input
          value={value ?? p.default}
          onChange={(e) => onValue(e.target.value)}
          className="input font-mono"
        />
      </div>
    );
  }

  if (p.kind === "model_ref") {
    const matching = (models || []).filter((m) => !p.forKind || m.kind === p.forKind);
    if (matching.length === 0) {
      return (
        <div className="space-y-1.5">
          <div className="label">{p.label}</div>
          <div className="text-[11px] text-amber-400/90 inline-flex items-center gap-1">
            <Activity size={10} strokeWidth={2.25} />
            no {p.forKind || "matching"} model installed — register one via POST /api/models
          </div>
        </div>
      );
    }
    const selected = matching.find((m) => m.id === value);
    return (
      <div className="space-y-1.5">
        <div className="label">{p.label}</div>
        <select
          value={value ?? ""}
          onChange={(e) => onValue(e.target.value || null)}
          className="input"
          title={selected?.description || ""}
        >
          {!value && <option value="">— select a model —</option>}
          {matching.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.builtin ? "" : " · custom"}
            </option>
          ))}
        </select>
        {selected?.description && (
          <div className="text-[11px] text-subtle/80 leading-snug">{selected.description}</div>
        )}
      </div>
    );
  }

  if (p.kind === "detector_ref") {
    if (detectors.length === 0) {
      return (
        <div className="space-y-1.5">
          <div className="label">{p.label}</div>
          <div className="text-[11px] text-amber-400/90 inline-flex items-center gap-1">
            <Activity size={10} strokeWidth={2.25} />
            no detector configured — add one above
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        <div className="label">{p.label}</div>
        <select
          value={value ?? ""}
          onChange={(e) => onValue(e.target.value || null)}
          className="input font-mono"
        >
          {detectors.map((d) => {
            const dspec = DETECTOR_TYPES[d.type];
            return (
              <option key={d.id} value={d.id}>
                {String(d.id).split("-")[0]}… · {dspec?.label || d.type}
              </option>
            );
          })}
        </select>
      </div>
    );
  }
  return null;
}
