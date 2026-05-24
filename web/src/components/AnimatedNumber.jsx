import { useEffect, useRef, useState } from "react";

// rAF-tweened number for metric displays. Snaps if the delta is small enough
// to not be worth animating (avoids constant jitter for high-frequency updates).
export default function AnimatedNumber({
  value, durationMs = 400, format = (v) => String(Math.round(v)), className = "",
}) {
  const [display, setDisplay] = useState(value);
  const startRef = useRef({ t: 0, from: value });
  const frameRef = useRef(0);

  useEffect(() => {
    const from = display;
    const to = value;
    const delta = Math.abs(to - from);
    if (delta < 0.5) { setDisplay(to); return; }
    startRef.current = { t: performance.now(), from };
    cancelAnimationFrame(frameRef.current);
    const tick = (now) => {
      const { t, from } = startRef.current;
      const p = Math.min(1, (now - t) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return <span className={`font-mono tabular-nums ${className}`}>{format(display)}</span>;
}
