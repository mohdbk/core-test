export default function Panel({ icon: Icon, title, count, right, children, className = "" }) {
  return (
    <section className={`pane ${className}`}>
      {(title || right) && (
        <header className="pane-h">
          {title && (
            <h3 className="pane-h-title">
              {Icon && <Icon size={12} strokeWidth={2} className="text-subtle/70" />}
              {title}
            </h3>
          )}
          {count !== undefined && <span className="pill">{count}</span>}
          <div className="flex-1" />
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
