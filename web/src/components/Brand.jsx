// Combined logo mark + wordmark for the TopBar. The mark also stands alone
// as the favicon-style brand glyph.
export default function Brand({ variant = "full" }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {variant === "full" && (
        <span className="text-[14px] font-semibold tracking-[0.1em] text-text">TANBEEH</span>
      )}
    </div>
  );
}

export function BrandMark({ size = 28 }) {
  return (
    <div
      className="relative grid place-items-center rounded-md"
      style={{
        width: size, height: size,
        background: "linear-gradient(135deg, rgba(34,211,238,.25), rgba(167,139,250,.20))",
        border: "1px solid rgba(255,255,255,.10)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.06), 0 0 18px -8px rgba(34,211,238,.55)",
      }}
    >
      <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="url(#bm)" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3.5" stroke="url(#bm)" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="1.4" fill="#22d3ee" />
        <defs>
          <linearGradient id="bm" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#22d3ee" />
            <stop offset="1" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
