import { useState } from "react";
import CameraVideo from "./CameraVideo.jsx";
import ZoneCanvas from "./ZoneCanvas.jsx";

export default function CameraStage({
  cameraId, zones, editable = true, drawMode = "polygon", drawLabel = "zone",
  onAddZone, onUpdateZone, onRemoveZone,
  selectedZoneId, onSelectZone,
}) {
  const [size, setSize] = useState({ w: 1280, h: 720 });

  return (
    <div className="relative h-full w-full grid place-items-center stage-bg rounded-2xl">
      <div
        className="relative rounded-xl overflow-hidden ring-1 ring-white/[.07] shadow-card"
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
        />
      </div>
    </div>
  );
}
