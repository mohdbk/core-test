import {
  Box, CircleHelp, Compass, Layers, Lock, LockOpen, MonitorPlay, MousePointer2, MoveDiagonal, Pencil, PencilLine, Plus,
  Power, Ruler, Sliders, Sparkles, Target, Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCamera } from "../hooks/useCamera.js";
import { useCameras } from "../hooks/useCameras.js";
import { useModels } from "../hooks/useModels.js";
import { DETECTOR_TYPES, RULE_TYPES } from "../registry.js";
import CameraStage from "../components/CameraStage.jsx";
import Card from "../components/Card.jsx";
import ColorPicker from "../components/ColorPicker.jsx";
import EmptyState from "../components/EmptyState.jsx";
import IconButton from "../components/IconButton.jsx";
import IdBadge from "../components/IdBadge.jsx";
import MetadataBlock from "../components/MetadataBlock.jsx";
import ModuleCard from "../components/ModuleCard.jsx";
import StatusDot from "../components/StatusDot.jsx";
import Tag from "../components/Tag.jsx";

// Config tab of the Operations Console. The Layout shell owns the left
// CameraList and the right LiveIncidents column — this view fills the
// middle column with: stage (for editing) on top, a 2-column grid of
// configuration cards below.
export default function ConfigView() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const { cameras } = useCameras();

  useEffect(() => {
    if (!cameraId && cameras[0]?.id) {
      navigate(`/config/${cameras[0].id}`, { replace: true });
    }
  }, [cameraId, cameras, navigate]);

  if (!cameraId) {
    return (
      <Card className="h-full">
        <EmptyState icon={MonitorPlay} title="No camera" hint="Add a camera from the list on the left." />
      </Card>
    );
  }
  return <ConfigWithCamera key={cameraId} cameraId={cameraId} />;
}

function ConfigWithCamera({ cameraId }) {
  const {
    camera, zones, modules,
    addZone, updateZone, removeZone,
    addDetector, addRule, updateModule, removeModule,
    setEnabled,
    saveStatus,
  } = useCamera(cameraId);
  const { models } = useModels();

  const [drawMode, setDrawMode]               = useState("polygon");
  const [drawLabel, setDrawLabel]             = useState("Zone");
  const [drawLocked, setDrawLocked]           = useState(true);
  const [selectedZoneId, setSelectedZoneId]   = useState(null);
  const [settingsZoneId, setSettingsZoneId]   = useState(null);

  function handleRemoveZone(id) {
    if (selectedZoneId === id) setSelectedZoneId(null);
    removeZone(id);
  }

  return (
    <div className="h-full grid gap-3 min-h-0" style={{ gridTemplateRows: "minmax(0, 55%) minmax(0, 45%)" }}>
      {/* ── Stage ──────────────────────────────────────────────── */}
      <div className="relative min-h-0">
        <CameraStage
          cameraId={cameraId}
          zones={zones}
          drawMode={drawMode}
          drawLabel={drawLabel}
          onAddZone={(z) => { addZone(z); setDrawLocked(true); }}
          onUpdateZone={updateZone}
          onRemoveZone={handleRemoveZone}
          selectedZoneId={selectedZoneId}
          onSelectZone={setSelectedZoneId}
          editable
          drawLocked={drawLocked}
        />
        <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-black/55 backdrop-blur-xl border border-white/[.10]">
          <StatusDot tone={camera?.enabled ? "live" : "neutral"} pulse={!!camera?.enabled} size={7} />
          <span className="text-[12px] font-semibold text-text">{camera?.name || "—"}</span>
          <span className="text-[10px] text-text/50 ml-1">Edit Mode</span>
        </div>
      </div>

      {/* ── Configuration grid ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 min-h-0">
        {/* Left column */}
        <div className="space-y-3 overflow-y-auto pr-1">
          <Card
            icon={MonitorPlay}
            title="Camera"
            right={<SaveBadge status={saveStatus} />}
          >
            <div className="flex items-start justify-between gap-3 mb-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate">{camera?.name || "…"}</div>
                <div className="text-[11px] text-text/55 mt-0.5">
                  {camera?.enabled ? "Publishing annotated stream" : "Disabled · idle"}
                </div>
              </div>
              <button
                onClick={() => setEnabled(!camera?.enabled)}
                className={camera?.enabled ? "btn-primary shrink-0" : "btn shrink-0"}
                title="Toggle enabled / disabled"
              >
                <Power size={12} strokeWidth={2} />
                {camera?.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
            <MetadataBlock
              items={[
                { key: "id",         value: camera?.id ? <IdBadge id={camera.id} label="camera ID" variant="full" /> : null },
                { key: "source",     value: camera?.source ? <span className="font-mono text-[11px] break-all text-text/80">{camera.source}</span> : null },
                { key: "resolution", value: camera ? `${camera.image_width || "?"}×${camera.image_height || "?"}` : null },
                { key: "stream",     value: camera?.id ? <span className="font-mono text-[11px] break-all text-text/80">{camera.id}-annotated</span> : null },
              ]}
            />
          </Card>

          <Card
            icon={PencilLine}
            title="Draw Tools"
            right={
              <Tag tone={drawLocked ? "neutral" : "warn"}>
                {drawLocked ? "Locked" : "Armed"}
              </Tag>
            }
          >
            <button
              onClick={() => setDrawLocked((v) => !v)}
              className={[
                "w-full inline-flex items-center justify-center gap-2 h-9 rounded-md text-[12px] font-medium border transition-colors",
                drawLocked
                  ? "bg-white/[.03] border-white/[.10] text-text hover:bg-white/[.06] hover:border-white/[.16]"
                  : "bg-amber-400/[.10] border-amber-400/50 text-amber-200 hover:bg-amber-400/[.18]",
              ].join(" ")}
            >
              {drawLocked
                ? <><Lock size={13} strokeWidth={2} /> Unlock to Draw</>
                : <><LockOpen size={13} strokeWidth={2} /> Lock Drawing</>}
            </button>

            <div className={["mt-3 transition-opacity", drawLocked ? "opacity-50 pointer-events-none" : ""].join(" ")}>
              <div className="flex items-center gap-2">
                <div className="rounded-md overflow-hidden border border-white/10 flex h-7">
                  <ModeBtn active={drawMode === "polygon"} onClick={() => setDrawMode("polygon")} icon={MousePointer2} label="Polygon" />
                  <ModeBtn active={drawMode === "line"}    onClick={() => setDrawMode("line")}    icon={MoveDiagonal}  label="Line" />
                </div>
                <input
                  value={drawLabel}
                  onChange={(e) => setDrawLabel(e.target.value)}
                  placeholder="Zone name"
                  className="input flex-1"
                />
              </div>
              <div className="text-[11px] text-text/55 mt-2 leading-relaxed flex items-start gap-1.5">
                <CircleHelp size={11} strokeWidth={2} className="text-text/40 mt-[1px] shrink-0" />
                <div className="space-y-1">
                  <p>
                    {drawMode === "polygon"
                      ? "Click to add vertices, then click the first vertex or press Enter to close."
                      : "Click point A then point B — the line commits automatically."}
                  </p>
                  <p className="text-text/40">
                    Editing: drag the body to move, click an edge to insert a vertex, right-click a vertex to remove, arrow keys nudge (Shift × 10).
                  </p>
                </div>
              </div>
            </div>

            {drawLocked && (
              <div className="text-[11px] text-text/55 mt-2 leading-snug">
                Drawing is locked to prevent accidental zones. Unlock to add a new zone; existing zones can still be edited.
              </div>
            )}
          </Card>

          <Card
            icon={Target}
            title="Zones"
            count={zones.length}
            right={
              <IconButton
                icon={Trash2}
                label="Clear all zones"
                variant="ghost"
                size="xs"
                disabled={zones.length === 0}
                onClick={() => zones.forEach((z) => handleRemoveZone(z.id))}
              />
            }
          >
            {zones.length === 0 ? (
              <EmptyState icon={Target} title="No zones yet" hint="Draw a polygon or line on the stream to create one." />
            ) : (
              <div className="space-y-1.5">
                {zones.map((z) => {
                  const editing      = z.id === selectedZoneId;
                  const showSettings = z.id === settingsZoneId;
                  return (
                    <div
                      key={z.id}
                      className={[
                        "rounded-md border transition-colors",
                        editing
                          ? "bg-cyan-400/[.06] border-cyan-400/30 shadow-[inset_0_0_0_1px_rgba(34,211,238,.20)]"
                          : "bg-white/[.02] border-white/[.06] hover:border-white/[.12]",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2 px-2.5 py-1.5">
                        <ColorPicker value={z.color} onChange={(color) => updateZone(z.id, { color })} />
                        <input
                          value={z.name}
                          onChange={(e) => updateZone(z.id, { name: e.target.value })}
                          className="bg-transparent text-[13px] outline-none flex-1 min-w-0"
                        />
                        <Tag tone={z.kind === "line" ? "info" : "neutral"}>{z.kind}</Tag>
                        <IconButton
                          icon={Sliders}
                          label={showSettings ? "Hide calibration" : "Calibration"}
                          variant={showSettings ? "accent" : "ghost"}
                          size="xs"
                          onClick={() => setSettingsZoneId(showSettings ? null : z.id)}
                        />
                        <IconButton
                          icon={Pencil}
                          label={editing ? "Done editing" : "Edit vertices"}
                          variant={editing ? "accent" : "ghost"}
                          size="xs"
                          onClick={() => setSelectedZoneId(editing ? null : z.id)}
                        />
                        <IconButton
                          icon={Trash2}
                          label="Delete zone"
                          variant="danger"
                          size="xs"
                          onClick={() => handleRemoveZone(z.id)}
                        />
                      </div>
                      {showSettings && (
                        <ZoneCalibration zone={z} onChange={(patch) => updateZone(z.id, patch)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-3 overflow-y-auto pr-1">
          <ModulePanel
            icon={Sparkles}
            title="Detectors"
            typeOptions={DETECTOR_TYPES}
            modules={modules.filter((m) => m.type in DETECTOR_TYPES)}
            allModules={modules}
            zones={zones}
            models={models}
            onAdd={(type) => addDetector(type)}
            onUpdate={updateModule}
            onRemove={removeModule}
            emptyHint="Rules need at least one detector to consume."
          />
          <ModulePanel
            icon={Layers}
            title="Rules"
            typeOptions={RULE_TYPES}
            modules={modules.filter((m) => m.type in RULE_TYPES)}
            allModules={modules}
            zones={zones}
            models={models}
            onAdd={(type) => addRule(type)}
            onUpdate={updateModule}
            onRemove={removeModule}
            emptyHint="Add a rule and point it at a detector."
          />
        </div>
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1 px-2.5 text-[11px] transition-colors",
        active
          ? "text-cyan-300 bg-cyan-400/10 shadow-[inset_0_0_0_1px_rgba(34,211,238,.35)]"
          : "text-text/60 hover:text-text hover:bg-white/[.04]",
      ].join(" ")}
    >
      <Icon size={11} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function ModulePanel({ icon, title, typeOptions, modules, allModules, zones, models, onAdd, onUpdate, onRemove, emptyHint }) {
  const [type, setType] = useState(Object.keys(typeOptions)[0]);
  return (
    <Card
      icon={icon}
      title={title}
      count={modules.length}
      right={
        <div className="flex items-center gap-1.5">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="input text-[11px] h-6 py-0 px-1.5 w-auto"
          >
            {Object.entries(typeOptions).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button onClick={() => onAdd(type)} className="btn-primary h-6 px-2 text-[11px]">
            <Plus size={11} strokeWidth={2.25} />
            Add
          </button>
        </div>
      }
    >
      {modules.length === 0 ? (
        <EmptyState icon={icon} title={`No ${title.toLowerCase()} yet`} hint={emptyHint} />
      ) : (
        <div className="space-y-2">
          {modules.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              modules={allModules}
              zones={zones}
              models={models}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// Per-zone optional calibration used by speed_enforcement (scale or
// homography) and the polygon variant of wrong_way (allowed direction).
function ZoneCalibration({ zone, onChange }) {
  if (zone.kind !== "polygon") {
    return (
      <div className="px-2.5 py-2 border-t border-white/[.05] text-[11px] text-text/55">
        Calibration not applicable for line zones.
      </div>
    );
  }
  const canCalibrate = (zone.points?.length === 4);
  return (
    <div className="px-2.5 py-2 border-t border-white/[.05] space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <CalibField
          icon={Ruler} label="Scale (px/m)"
          title="Pixels per real-world meter. Used by speed_enforcement when homography is off."
          value={zone.scale_px_per_m} step={0.1}
          onChange={(v) => onChange({ scale_px_per_m: v })}
        />
        <CalibField
          icon={Compass} label="Direction (°)"
          title="Allowed direction of travel (0=east, 90=south). Used by wrong_way."
          value={zone.allowed_direction_deg} step={1} min={0} max={359}
          onChange={(v) => onChange({ allowed_direction_deg: v })}
        />
      </div>

      <div className="border-t border-white/[.05] pt-2">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!zone.use_homography}
            disabled={!canCalibrate}
            onChange={(e) => onChange({ use_homography: e.target.checked })}
            className="w-3.5 h-3.5 accent-cyan-400 disabled:opacity-40"
          />
          <span className="label flex items-center gap-1 text-text/85">
            <Box size={10} strokeWidth={2.25} />
            Ground reference (4-point perspective)
          </span>
        </label>
        {!canCalibrate && (
          <div className="text-[11px] text-amber-300/80 mt-1 ml-5">
            Needs exactly 4 vertices ({zone.points?.length || 0} now).
          </div>
        )}
        {canCalibrate && (
          <div className="text-[11px] text-text/55 mt-1 ml-5 leading-snug">
            Maps the polygon's 4 vertices to a real-world rectangle. Required for
            accurate m/s on perspective views.
          </div>
        )}
        {canCalibrate && zone.use_homography && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <CalibField icon={Ruler} label="Width (m)"  value={zone.ground_w_m} step={0.1} min={0.1}
                        onChange={(v) => onChange({ ground_w_m: v })} />
            <CalibField icon={Ruler} label="Height (m)" value={zone.ground_h_m} step={0.1} min={0.1}
                        onChange={(v) => onChange({ ground_h_m: v })} />
          </div>
        )}
      </div>
    </div>
  );
}

function CalibField({ icon: Icon, label, title, value, step, min, max, onChange }) {
  return (
    <label className="flex flex-col gap-1" title={title}>
      <span className="label flex items-center gap-1 text-text/55">
        <Icon size={10} strokeWidth={2} />
        {label}
      </span>
      <input
        type="number"
        value={value ?? ""}
        placeholder="—"
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="input font-mono h-7 text-[12px]"
      />
    </label>
  );
}

function SaveBadge({ status }) {
  const tones = {
    saved:     { tone: "ok",      label: "Saved" },
    saving:    { tone: "warn",    label: "Saving…" },
    pending:   { tone: "warn",    label: "Pending" },
    loading:   { tone: "neutral", label: "Loading…" },
    migrating: { tone: "warn",    label: "Migrating…" },
    error:     { tone: "alert",   label: "Save failed" },
    offline:   { tone: "neutral", label: "Offline" },
    idle:      { tone: "neutral", label: "—" },
  };
  const { tone, label } = tones[status] || tones.idle;
  return <Tag tone={tone}>{label}</Tag>;
}
