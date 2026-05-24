import { useEffect, useRef, useState } from "react";
import { newUuid } from "../registry.js";

// SVG zone editor.
//
// Selection is controlled (lifted to the parent) so the sidebar's Edit button
// and the canvas stay in sync.
//
// Editing interactions on the selected zone:
//   - drag a vertex handle           → move that point
//   - right-click a vertex           → remove it (polygons only, min 3 points)
//   - click on a (segment) edge      → insert a vertex at the click point
//   - drag the zone body             → translate the whole zone
//   - arrow keys                     → nudge the whole zone (1 px, shift = 10)
//   - Delete / Backspace             → remove the zone
//   - Esc                            → deselect
//
// `editable=false` (Stream view) renders just the outline + name, no chrome.
export default function ZoneCanvas({
  width, height, zones, drawMode, drawLabel,
  onAddZone, onUpdateZone, onRemoveZone,
  selectedZoneId, onSelectZone,
  editable = true,
}) {
  const svgRef = useRef(null);
  const [draft, setDraft] = useState(null);        // {points, mode}
  const [hover, setHover] = useState(null);
  // {zoneId, kind:"vertex"|"zone", idx?, startMouse, startPoints}
  const [drag, setDrag] = useState(null);

  const selected    = selectedZoneId;
  const setSelected = (id) => onSelectZone?.(id);

  function toNative(evt) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return {
      x: Math.max(0, Math.min(width,  p.x)),
      y: Math.max(0, Math.min(height, p.y)),
    };
  }

  // ── Background click: draw or deselect ─────────────────────────────────
  function backgroundDown(e) {
    if (!editable || e.button !== 0) return;
    const p = toNative(e);
    if (!draft) {
      if (selected) { setSelected(null); return; }
      setDraft({ points: [p], mode: drawMode });
      return;
    }
    if (draft.mode === "polygon" && draft.points.length >= 3 && distPx(svgRef.current, p, draft.points[0]) < 10) {
      commit();
      return;
    }
    const pts = [...draft.points, p];
    if (draft.mode === "line" && pts.length >= 2) { commitWith(pts); return; }
    setDraft({ ...draft, points: pts });
  }

  function commit()        { if (draft) commitWith(draft.points); }
  function commitWith(points) {
    if (!draft) return;
    const minPts = draft.mode === "line" ? 2 : 3;
    if (points.length < minPts) return;
    const name = (drawLabel || (draft.mode === "line" ? "line" : "zone")).trim();
    onAddZone?.({
      id: newUuid(), name, kind: draft.mode,
      points: draft.mode === "line" ? points.slice(0, 2) : points,
    });
    setDraft(null);
  }
  function cancelDraft() { setDraft(null); }

  // ── Drag handlers (vertex / zone-body) ─────────────────────────────────
  function pointerMove(e) {
    if (!editable) return;
    const p = toNative(e);
    setHover(p);
    if (!drag) return;
    const zone = zones.find((z) => z.id === drag.zoneId);
    if (!zone) return;
    if (drag.kind === "vertex") {
      const next = drag.startPoints.map((pt, i) => (i === drag.idx ? p : pt));
      onUpdateZone?.(drag.zoneId, { points: next });
    } else if (drag.kind === "zone") {
      const dx = p.x - drag.startMouse.x;
      const dy = p.y - drag.startMouse.y;
      const next = drag.startPoints.map((pt) => ({
        x: clamp(pt.x + dx, 0, width),
        y: clamp(pt.y + dy, 0, height),
      }));
      onUpdateZone?.(drag.zoneId, { points: next });
    }
  }
  function pointerUp() { if (drag) setDrag(null); }

  function startVertexDrag(zoneId, idx, e) {
    if (!editable) return;
    e.stopPropagation();
    setSelected(zoneId);
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    setDrag({
      zoneId, kind: "vertex", idx,
      startMouse: toNative(e),
      startPoints: zone.points.map((p) => ({ ...p })),
    });
    try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  }

  function startZoneDrag(zoneId, e) {
    if (!editable) return;
    e.stopPropagation();
    setSelected(zoneId);
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    setDrag({
      zoneId, kind: "zone",
      startMouse: toNative(e),
      startPoints: zone.points.map((p) => ({ ...p })),
    });
    try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  }

  function insertVertex(zoneId, segmentIdx, e) {
    if (!editable) return;
    e.stopPropagation();
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone || zone.kind !== "polygon") return;
    const p = toNative(e);
    const next = [...zone.points];
    next.splice(segmentIdx + 1, 0, p);
    onUpdateZone?.(zoneId, { points: next });
    setSelected(zoneId);
    // Immediately start dragging the new vertex so it follows the cursor.
    setDrag({
      zoneId, kind: "vertex", idx: segmentIdx + 1,
      startMouse: p,
      startPoints: next.map((pt) => ({ ...pt })),
    });
    try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  }

  function removeVertex(zoneId, idx, e) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone || zone.kind !== "polygon") return;
    if (zone.points.length <= 3) return;   // a polygon needs >= 3
    const next = zone.points.filter((_, i) => i !== idx);
    onUpdateZone?.(zoneId, { points: next });
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    if (!editable) return;
    function onKey(e) {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "SELECT" || e.target?.isContentEditable) return;
      if (e.key === "Escape") {
        if (draft) cancelDraft();
        else setSelected(null);
        return;
      }
      if (e.key === "Enter" && draft && draft.points.length >= (draft.mode === "line" ? 2 : 3)) {
        e.preventDefault(); commit(); return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && draft) {
        const pts = draft.points.slice(0, -1);
        if (pts.length === 0) cancelDraft();
        else setDraft({ ...draft, points: pts });
        e.preventDefault();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        onRemoveZone?.(selected);
        setSelected(null);
        e.preventDefault();
        return;
      }
      // Arrow-key nudge — translates the whole selected zone.
      if (selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        const zone = zones.find((z) => z.id === selected);
        if (!zone) return;
        const next = zone.points.map((p) => ({
          x: clamp(p.x + dx, 0, width),
          y: clamp(p.y + dy, 0, height),
        }));
        onUpdateZone?.(selected, { points: next });
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, selected, zones, width, height, editable]);  // eslint-disable-line

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={`absolute inset-0 w-full h-full ${editable ? "cursor-crosshair" : ""}`}
      onPointerDown={backgroundDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={() => { setHover(null); pointerUp(); }}
      onDoubleClick={() => editable && draft && draft.points.length >= 3 && commit()}
      onContextMenu={(e) => { if (editable) { e.preventDefault(); cancelDraft(); } }}
    >
      {zones.map((z) => (
        <ZoneShape
          key={z.id}
          zone={z}
          selected={selected === z.id}
          editable={editable}
          onSelectBody={(e) => {
            // Body click on a non-selected zone selects; on the selected zone
            // it starts translation.
            if (z.id === selected) startZoneDrag(z.id, e);
            else { e.stopPropagation(); setSelected(z.id); }
          }}
          onEdgeDown={(idx, e)   => insertVertex(z.id, idx, e)}
          onVertexDown={(idx, e) => startVertexDrag(z.id, idx, e)}
          onVertexRemove={(idx, e) => removeVertex(z.id, idx, e)}
        />
      ))}

      {editable && draft && <DraftShape draft={draft} hover={hover} />}
    </svg>
  );
}

function ZoneShape({ zone, selected, editable, onSelectBody, onEdgeDown, onVertexDown, onVertexRemove }) {
  const stroke = zone.color || "#22d3ee";
  const fill   = withAlpha(stroke, selected ? 0.22 : 0.10);
  const stroke_w = selected ? 3 : 2;
  const showHandles = editable && selected;
  const bodyCursor =
    !editable        ? "default" :
    selected         ? "move"    :
    "pointer";

  if (zone.kind === "line") {
    const [a, b] = zone.points;
    return (
      <g style={{ pointerEvents: editable ? "auto" : "none" }}>
        {/* wider transparent hit area so the line is easy to click */}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="transparent" strokeWidth={14}
              onPointerDown={onSelectBody} style={{ cursor: bodyCursor }} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke} strokeWidth={stroke_w} strokeLinecap="round"
              onPointerDown={onSelectBody} style={{ cursor: bodyCursor }} />
        {showHandles && (
          <>
            <EndpointLabel p={a} text="A" color={stroke} />
            <EndpointLabel p={b} text="B" color={stroke} />
            <Vertex p={a} color={stroke} idx={0} onPointerDown={onVertexDown} draggable />
            <Vertex p={b} color={stroke} idx={1} onPointerDown={onVertexDown} draggable />
          </>
        )}
        <ZoneLabel p={topLeft(zone.points)} text={zone.name} color={stroke} />
      </g>
    );
  }

  // Polygon
  const d = zone.points.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" ") + " Z";
  return (
    <g style={{ pointerEvents: editable ? "auto" : "none" }}>
      {/* Body — captures clicks on fill / outline */}
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke_w}
        strokeLinejoin="round"
        onPointerDown={onSelectBody}
        style={{ cursor: bodyCursor }}
      />
      {/* Edge hit areas — only when this zone is the edit target. Layered
          ABOVE the body so a click near an edge inserts a vertex rather than
          starting a body drag. */}
      {showHandles && zone.points.map((p1, i) => {
        const p2 = zone.points[(i + 1) % zone.points.length];
        return (
          <line
            key={`edge-${i}`}
            x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke="transparent" strokeWidth={14}
            onPointerDown={(e) => onEdgeDown(i, e)}
            style={{ cursor: "copy" }}
          />
        );
      })}
      {/* Vertices on top of everything */}
      {showHandles && zone.points.map((p, i) => (
        <Vertex
          key={i}
          p={p}
          color={stroke}
          idx={i}
          onPointerDown={onVertexDown}
          onContextMenu={(e) => onVertexRemove(i, e)}
          draggable
        />
      ))}
      <ZoneLabel p={topLeft(zone.points)} text={zone.name} color={stroke} />
    </g>
  );
}

function DraftShape({ draft, hover }) {
  const pts = draft.points;
  const stroke = "#fbbf24";
  const d = pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" ") +
            (hover ? " L" + hover.x + "," + hover.y : "");
  return (
    <g pointerEvents="none">
      <path d={d} stroke={stroke} strokeWidth="2" fill="none" strokeDasharray="6 4" />
      {pts.map((p, i) => <Vertex key={i} p={p} color={stroke} idx={i} />)}
      {draft.mode === "polygon" && pts.length >= 3 && hover && (
        <Vertex p={pts[0]} color="#22d3ee" idx={-1} big />
      )}
    </g>
  );
}

function Vertex({ p, color, big, idx, onPointerDown, onContextMenu, draggable }) {
  const r = big || draggable ? 6 : 4;
  return (
    <g
      onPointerDown={(e) => onPointerDown?.(idx, e)}
      onContextMenu={onContextMenu}
      style={{ cursor: draggable ? "grab" : "default" }}
    >
      {/* invisible hit area, bigger than the visible dot, for easier grabbing */}
      <circle cx={p.x} cy={p.y} r={r + 6} fill="transparent" />
      <circle cx={p.x} cy={p.y} r={r + 2} fill="#06070d" />
      <circle cx={p.x} cy={p.y} r={r}     fill={color} />
      {draggable && (
        <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={color} strokeOpacity=".35" strokeWidth="1" />
      )}
    </g>
  );
}

function EndpointLabel({ p, text, color }) {
  return (
    <g transform={`translate(${p.x + 10}, ${p.y - 10})`} pointerEvents="none">
      <rect x="-2" y="-12" width="16" height="16" rx="4" fill={color} />
      <text x="6" y="0" textAnchor="middle" fontSize="11"
            fontFamily="JetBrains Mono, monospace" fontWeight="700" fill="#06070d">{text}</text>
    </g>
  );
}

function ZoneLabel({ p, text, color }) {
  if (!text) return null;
  const w = text.length * 7.2 + 14;
  return (
    <g transform={`translate(${p.x}, ${p.y - 8})`} pointerEvents="none">
      <rect x="0" y="-15" width={w} height="18" rx="5" fill={color} />
      <text x="7" y="-2" fontSize="11" fontFamily="Inter, sans-serif" fontWeight="600" fill="#06070d">{text}</text>
    </g>
  );
}

function topLeft(pts) {
  let x = Infinity, y = Infinity;
  for (const p of pts) { if (p.x < x) x = p.x; if (p.y < y) y = p.y; }
  return { x, y };
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function distPx(svg, a, b) {
  if (!svg) return Infinity;
  const ctm = svg.getScreenCTM();
  if (!ctm) return Infinity;
  const dx = (a.x - b.x) * ctm.a;
  const dy = (a.y - b.y) * ctm.d;
  return Math.hypot(dx, dy);
}
function withAlpha(hex, a) {
  if (!hex || hex[0] !== "#") return `rgba(34,211,238,${a})`;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
