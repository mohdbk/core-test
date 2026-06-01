// Replaces Panel.jsx. Three slots: title (with optional icon + actions on
// the right), and a body. No backdrop-blur — solid surface stack instead.
//
// Variants:
//   raised  — slightly brighter surface (use for selected / focus state)
//   hover   — gains the raised look on hover (use in lists)
//   bare    — no border or background; only adds the title row spacing
//
// Pass `className` for layout (height, flex, etc.) on the outer wrapper.
export default function Card({
  icon: Icon,
  title,
  count,
  right,
  children,
  variant = "default",
  className = "",
  bodyClassName = "p-3",
  asChild = false,
}) {
  const base = {
    default: "card",
    raised:  "card-raised",
    hover:   "card card-hover",
    bare:    "",
  }[variant] || "card";

  return (
    <section className={[base, "flex flex-col min-h-0", className].join(" ")}>
      {(title || right || Icon) && (
        <header className="card-header">
          {Icon && <Icon size={12} strokeWidth={2} className="text-text/55" />}
          {title && <span className="card-header-title">{title}</span>}
          {count != null && (
            <span className="font-mono tabular-nums text-[10px] text-text/50">{count}</span>
          )}
          {right && <div className="ml-auto flex items-center gap-1.5">{right}</div>}
        </header>
      )}
      {asChild
        ? children
        : <div className={["min-h-0", bodyClassName].join(" ")}>{children}</div>}
    </section>
  );
}
