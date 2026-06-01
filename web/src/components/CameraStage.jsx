import { useState } from "react";
import CameraVideo from "./CameraVideo.jsx";
import ZoneCanvas from "./ZoneCanvas.jsx";

export default function CameraStage({
  cameraId, zones, editable = true, drawMode = "polygon", drawLabel = "zone",
  onAddZone, onUpdateZone, onRemoveZone,
  selectedZoneId, onSelectZone,
  drawLocked = true,
}) {
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const armed = editable && !drawLocked;

  return (
    <div className="relative h-full w-full grid place-items-center stage-bg rounded-2xl">
      <div
        className={[
          "relative rounded-xl overflow-hidden shadow-card transition-shadow",
          armed
            ? "ring-2 ring-amber-400/60 shadow-[0_0_0_1px_rgba(251,191,36,.20),0_0_42px_-6px_rgba(251,191,36,.40)]"
            : "ring-1 ring-white/[.07]",
        ].join(" ")}
        style={{ aspectRatio: `${size.w}/${size.h}`, maxHeight: "100%", maxWidth: "100%", width: "100%" }}
      >
        <CameraVideo
          cameraId={cameraId}
          onResolution={(w, h) => setSize({ w, h })}
        />
        <ZoneCanvas
          width={size.w}
          height={size.h}
          zones={zones}
          drawMode={drawMode}
          drawLabel={drawLabel}
          onAddZone={onAddZone}
          onUpdateZone={onUpdateZone}
          onRemoveZone={onRemoveZone}
          selectedZoneId={selectedZoneId}
          onSelectZone={onSelectZone}
          editable={editable}
          drawLocked={drawLocked}
        />
        {armed && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 h-7 rounded-full bg-amber-500/15 backdrop-blur-md border border-amber-400/45 shadow-[0_0_18px_-4px_rgba(251,191,36,.55)] animate-fade-in">
            <span className="relative inline-flex">
              <span className="absolute inline-flex h-2 w-2 rounded-full bg-amber-400 opacity-70 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <span className="text-[11px] font-medium text-amber-200">
              Drawing Armed
              <span className="text-amber-200/70 ml-1.5">· Click to place vertices · Esc to cancel</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
