// Consistent empty-state block. Centered icon + short copy. Use inside
// Card bodies or list containers.
export default function EmptyState({ icon: Icon, title, hint, action, className = "" }) {
  return (
    <div className={["flex flex-col items-center text-center px-4 py-6", className].join(" ")}>
      {Icon && (
        <div className="w-9 h-9 grid place-items-center rounded-lg border border-white/[.08] bg-white/[.02] mb-2.5">
          <Icon size={15} strokeWidth={1.5} className="text-text/45" />
        </div>
      )}
      {title && <div className="text-[12px] text-text/85 font-medium">{title}</div>}
      {hint  && <div className="text-[11px] text-text/55 mt-1 max-w-[28ch] leading-snug">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
