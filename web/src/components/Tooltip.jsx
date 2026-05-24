import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Portal-based tooltip — escapes any ancestor stacking context (the nav rail
// uses `backdrop-blur-xl` which creates one, so a plain `z-50 absolute` would
// have stayed trapped behind sibling content). We compute the screen position
// from the trigger's bounding rect and render the bubble into <body>.
export default function Tooltip({ label, side = "bottom", children }) {
  const [show, setShow] = useState(false);
  const [pos, setPos]   = useState(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!show || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const places = {
      bottom: { left: r.left + r.width / 2, top: r.bottom + 6,             tx: "-50%",        ty: "0" },
      top:    { left: r.left + r.width / 2, top: r.top - 6,                tx: "-50%",        ty: "-100%" },
      right:  { left: r.right + 6,          top: r.top + r.height / 2,     tx: "0",           ty: "-50%" },
      left:   { left: r.left - 6,           top: r.top + r.height / 2,     tx: "-100%",       ty: "-50%" },
    };
    setPos(places[side] || places.bottom);
  }, [show, side]);

  if (!label) return children;

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
      >
        {children}
      </span>
      {show && pos && createPortal(
        <span
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            transform: `translate(${pos.tx}, ${pos.ty})`,
            pointerEvents: "none",
            zIndex: 9999,
          }}
          className="whitespace-nowrap rounded-md bg-elevated/95 backdrop-blur-md
                     border border-white/10 text-[11px] text-text px-2 py-1
                     shadow-card animate-fade-in"
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}
