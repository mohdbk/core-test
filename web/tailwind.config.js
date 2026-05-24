/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg:          "#05060d",
        surface:     "#0b0c14",
        elevated:    "#10121d",
        sunken:      "#070811",
        border:      "#1a1c2c",
        line:        "#222438",
        muted:       "#6b7280",
        text:        "#e7e9ee",
        subtle:      "#9aa4b2",
        // Accent palette
        cyan: {
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
        violet: {
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
        },
        rose: {
          400: "#fb7185",
          500: "#f43f5e",
        },
        emerald: {
          400: "#34d399",
          500: "#10b981",
        },
        amber: {
          400: "#fbbf24",
          500: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontFeatureSettings: {
        tabular: '"tnum", "lnum"',
      },
      boxShadow: {
        // Subtler card shadows + a focused glow utility.
        card:      "0 1px 0 0 rgba(255,255,255,.03) inset, 0 12px 32px -16px rgba(0,0,0,.7)",
        ring:      "0 0 0 1px rgba(34, 211, 238, .35), 0 0 22px -8px rgba(34, 211, 238, .35)",
        "ring-rose": "0 0 0 1px rgba(244, 63, 94, .35), 0 0 22px -8px rgba(244, 63, 94, .35)",
        "ring-amber": "0 0 0 1px rgba(245, 158, 11, .35), 0 0 22px -8px rgba(245, 158, 11, .35)",
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "fade-in":   "fade-in .2s ease-out",
        "slide-up":  "slide-up .25s ease-out",
        "slide-in":  "slide-in .25s ease-out",
        "shimmer":   "shimmer 2.5s linear infinite",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: 1, transform: "scale(1)" },
          "50%":      { opacity: .45, transform: "scale(.85)" },
        },
        "fade-in":  { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } },
        "slide-in": { from: { opacity: 0, transform: "translateX(-6px)" }, to: { opacity: 1, transform: "translateX(0)" } },
        "shimmer":  { from: { backgroundPosition: "-200% 0" }, to: { backgroundPosition: "200% 0" } },
      },
    },
  },
  plugins: [],
};
