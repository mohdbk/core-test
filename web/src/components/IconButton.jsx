import Tooltip from "./Tooltip.jsx";

// Square icon-only button with a built-in tooltip.
// Use this whenever the icon alone is the affordance (delete, edit, copy…).
export default function IconButton({
  icon: Icon, label, onClick, variant = "ghost",
  size = "sm", side = "bottom", className = "", disabled, type = "button",
}) {
  const sizes = {
    xs: "w-6 h-6", sm: "w-7 h-7", md: "w-8 h-8",
  };
  const variants = {
    ghost:   "text-subtle hover:text-text hover:bg-white/[.06] border border-transparent",
    subtle:  "text-text bg-white/[.04] hover:bg-white/[.08] border border-white/5 hover:border-white/15",
    accent:  "text-cyan-400 bg-cyan-400/10 hover:bg-cyan-400/15 border border-cyan-400/20 hover:border-cyan-400/40",
    danger:  "text-rose-400 bg-rose-500/5 hover:bg-rose-500/15 border border-rose-500/20 hover:border-rose-500/40",
  };
  const iconSize = size === "xs" ? 12 : size === "md" ? 16 : 14;
  return (
    <Tooltip label={label} side={side}>
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-md transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${sizes[size] || sizes.sm} ${variants[variant] || variants.ghost} ${className}`}
      >
        <Icon size={iconSize} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}
