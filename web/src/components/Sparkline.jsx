// Tiny SVG sparkline — `data` is a flat array of numbers. Renders a polyline
// + an area fill underneath. No labels, no axis — meant for top-bar metrics.
export default function Sparkline({
  data, width = 64, height = 22, stroke = "#22d3ee", strokeWidth = 1.5,
  fillFrom = "rgba(34, 211, 238, .25)", fillTo = "rgba(34, 211, 238, 0)",
}) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} />;
  }
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  if (min === max) { min -= 1; max += 1; }
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const ys = data.map((v) => height - ((v - min) / range) * (height - 2) - 1);
  const points = ys.map((y, i) => `${(i * stepX).toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaD = `M0,${height} L${points} L${width},${height} Z`;
  const gradId = `sg-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <svg width={width} height={height} className="overflow-visible block">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={fillFrom} />
          <stop offset="100%" stopColor={fillTo} />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Trailing dot */}
      <circle cx={width} cy={ys[ys.length - 1]} r={1.75} fill={stroke} />
    </svg>
  );
}
