import {
  CircleHelp, Layers, MonitorPlay, MousePointer2, MoveDiagonal, Pencil, PencilLine, Plus,
  Power, Sparkles, Target, Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCamera } from "../hooks/useCamera.js";
import { useCameras } from "../hooks/useCameras.js";
import { useEngineStatus } from "../hooks/useEngineStatus.js";
import { useEvents } from "../hooks/useEvents.js";
import { DETECTOR_TYPES, RULE_TYPES } from "../registry.js";
import CameraStage from "../components/CameraStage.jsx";
import ColorPicker from "../components/ColorPicker.jsx";
import EventsPanel from "../components/EventsPanel.jsx";
import IconButton from "../components/IconButton.jsx";
import IdBadge from "../components/IdBadge.jsx";
import MetadataBlock from "../components/MetadataBlock.jsx";
import ModuleCard from "../components/ModuleCard.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

export default function ConfigView() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const { cameras } = useCameras();

  useEffect(() => {
    if (!cameraId && cameras[0]?.id) {
      navigate(`/config/${cameras[0].id}`, { replace: true });
    }
  }, [cameraId, cameras, navigate]);

  if (!cameraId) return <EmptyShell message="Loading cameras…" />;
  return <ConfigViewWithCamera key={cameraId} cameraId={cameraId} />;
}

function ConfigViewWithCamera({ cameraId }) {
  const {
    camera, zones, modules,
    addZone, updateZone, removeZone,
    addDetector, addRule, updateModule, removeModule,
    setEnabled,
    saveStatus,
  } = useCamera(cameraId);
  const { status: engineStatus } = useEngineStatus(cameraId);
  const { events, status: wsStatus } = useEvents(cameraId);

  const [drawMode, setDrawMode] = useState("polygon");
  const [drawLabel, setDrawLabel] = useState("zone");
  // Selected = "in edit mode": vertex handles are visible + draggable. Lifted
  // here so the Zones panel's Edit IconButton can drive it too.
  const [selectedZoneId, setSelectedZoneId] = useState(null);

  function handleRemoveZone(id) {
    if (selectedZoneId === id) setSelectedZoneId(null);
    removeZone(id);
  }

  return (
    <div className="grid grid-cols-[1fr_400px] gap-3 h-full min-h-0">
      <div className="min-h-0 min-w-0 relative">
        <CameraStage
          cameraId={cameraId}
          zones={zones}
          drawMode={drawMode}
          drawLabel={drawLabel}
          onAddZone={addZone}
          onUpdateZone={updateZone}
          onRemoveZone={handleRemoveZone}
          selectedZoneId={selectedZoneId}
          onSelectZone={setSelectedZoneId}
          editable
        />
      </div>

      <aside className="overflow-y-auto pr-1 space-y-3 min-h-0">
        {/* Camera summary */}
        <Panel
          icon={MonitorPlay}
          title="Camera"
          right={<SaveBadge status={saveStatus} />}
        >
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate">{camera?.name || "…"}</div>
              <div className="text-[11px] text-subtle/80 mt-0.5">
                {camera?.enabled ? "Live · publishing annotated stream" : "Disabled · idle"}
              </div>
            </div>
            <button
              onClick={() => setEnabled(!camera?.enabled)}
              className={`btn gap-1.5 shrink-0 ${camera?.enabled ? "border-cyan-400/40 text-cyan-400" : ""}`}
              title="Toggle enabled / disabled"
            >
              <Power size={12} strokeWidth={2} />
              {camera?.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <MetadataBlock
            items={[
              { key: "id",         value: camera?.id ? <IdBadge id={camera.id} label="camera ID" variant="full" /> : null },
              { key: "source",     value: camera?.source ? <span className="font-mono text-[11px] break-all">{camera.source}</span> : null },
              { key: "resolution", value: camera ? `${camera.image_width || "?"}×${camera.image_height || "?"}` : null },
              { key: "stream",     value: camera?.id ? <span className="font-mono text-[11px] break-all">{camera.id}-annotated</span> : null },
            ]}
          />
        </Panel>

        {/* Draw tools */}
        <Panel icon={PencilLine} title="Draw tools">
          <div className="flex items-center gap-2">
            <div className="rounded-md overflow-hidden border border-white/10 flex h-7">
              <ModeBtn active={drawMode === "polygon"} onClick={() => setDrawMode("polygon")}
                       icon={MousePointer2} label="Polygon" />
              <ModeBtn active={drawMode === "line"} onClick={() => setDrawMode("line")}
                       icon={MoveDiagonal} label="Line" />
            </div>
            <input
              value={drawLabel}
              onChange={(e) => setDrawLabel(e.target.value)}
              placeholder="zone name"
              className="input flex-1"
            />
          </div>
          <div className="text-[11px] text-subtle mt-2 leading-relaxed flex items-start gap-1.5">
            <CircleHelp size={11} strokeWidth={2} className="text-subtle/60 mt-[1px] shrink-0" />
            <div className="space-y-1">
              <p>
                {drawMode === "polygon"
                  ? "Click to add vertices · click first vertex or Enter to close · Esc cancels"
                  : "Click point A then point B — line auto-commits · Esc cancels"}
              </p>
              <p className="text-subtle/70">
                Editing: drag body to move · click edge to add vertex · right-click vertex to remove · arrows nudge (⇧ × 10)
              </p>
            </div>
          </div>
        </Panel>

        {/* Zones */}
        <Panel
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
            <EmptyHint icon={Target}>
              Draw a polygon or line on the stream to create a zone.
            </EmptyHint>
          ) : (
            <div className="space-y-1.5">
              {zones.map((z) => {
                const editing = z.id === selectedZoneId;
                return (
                  <div
                    key={z.id}
                    className={[
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors",
                      editing
                        ? "bg-cyan-400/[.06] border-cyan-400/30 shadow-[inset_0_0_0_1px_rgba(34,211,238,.20)]"
                        : "bg-black/20 border-white/[.07] hover:border-white/[.12]",
                    ].join(" ")}
                  >
                    <ColorPicker
                      value={z.color}
                      onChange={(color) => updateZone(z.id, { color })}
                    />
                    <input
                      value={z.name}
                      onChange={(e) => updateZone(z.id, { name: e.target.value })}
                      className="bg-transparent text-[13px] outline-none flex-1 min-w-0"
                    />
                    <span className="pill">{z.kind}</span>
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
                );
              })}
            </div>
          )}
        </Panel>

        {/* Detectors */}
        <ModulePanel
          icon={Sparkles}
          title="Detectors"
          typeOptions={DETECTOR_TYPES}
          modules={modules.filter((m) => m.type in DETECTOR_TYPES)}
          allModules={modules}
          zones={zones}
          onAdd={(type) => addDetector(type)}
          onUpdate={updateModule}
          onRemove={removeModule}
          emptyHint="No detectors yet. Rules need at least one detector to consume."
        />

        {/* Rules */}
        <ModulePanel
          icon={Layers}
          title="Rules"
          typeOptions={RULE_TYPES}
          modules={modules.filter((m) => m.type in RULE_TYPES)}
          allModules={modules}
          zones={zones}
          onAdd={(type) => addRule(type)}
          onUpdate={updateModule}
          onRemove={removeModule}
          emptyHint="No rules yet. Add an Intrusion / Presence / PPE rule and point it at a detector."
        />

        {/* Engine + events */}
        <EventsPanel
          events={events}
          wsStatus={wsStatus}
          engineStatus={engineStatus}
          zones={zones}
        />
      </aside>
    </div>
  );
}

function ModeBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 text-[11px] transition-colors ${
        active
          ? "text-cyan-400 bg-cyan-400/10 shadow-[inset_0_0_0_1px_rgba(34,211,238,.4)]"
          : "text-subtle hover:text-text hover:bg-white/[.04]"
      }`}
    >
      <Icon size={11} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function ModulePanel({ icon, title, typeOptions, modules, allModules, zones, onAdd, onUpdate, onRemove, emptyHint }) {
  const [type, setType] = useState(Object.keys(typeOptions)[0]);
  return (
    <Panel
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
        <EmptyHint icon={icon}>{emptyHint}</EmptyHint>
      ) : (
        <div className="space-y-2">
          {modules.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              modules={allModules}
              zones={zones}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function EmptyHint({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2.5 text-subtle/80 text-[12px] px-2 py-3">
      {Icon && (
        <div className="w-7 h-7 grid place-items-center rounded-md bg-white/[.03] border border-white/[.07] shrink-0">
          <Icon size={13} strokeWidth={1.75} className="text-subtle/60" />
        </div>
      )}
      <p className="leading-snug">{children}</p>
    </div>
  );
}

function EmptyShell({ message }) {
  return <div className="h-full grid place-items-center text-subtle">{message}</div>;
}

function SaveBadge({ status }) {
  const map = {
    saved:     ["ok",      "Saved"],
    saving:    ["pending", "Saving…", true],
    pending:   ["pending", "Pending", false],
    loading:   ["loading", "Loading…", true],
    migrating: ["pending", "Migrating…", true],
    error:     ["error",   "Save failed"],
    offline:   ["offline", "Offline"],
    idle:      ["neutral", "—"],
  };
  const [tone, label, spin] = map[status] || map.idle;
  return <StatusBadge tone={tone} label={label} spin={!!spin} />;
}
