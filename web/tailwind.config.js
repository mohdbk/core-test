/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Surface stack (also exposed as CSS vars in styles.css)
        canvas:      "#07080f",
        "surface-1": "#0c0f17",
        "surface-2": "#11141d",
        "surface-3": "#181c27",
        "surface-4": "#21263a",
        // Back-compat aliases used by older components — point at the new stack
        bg:          "#07080f",
        surface:     "#0c0f17",
        elevated:    "#11141d",
        sunken:      "#070811",
        border:      "#1a1c2c",
        line:        "#222438",
        muted:       "#6b7280",
        text:        "#e7e9ee",
        "text-soft": "#b6bcc8",
        "text-dim":  "#7a8294",
        "text-faint":"#5b6478",
        subtle:      "#9aa4b2",
        // Semantic accents
        cyan: {
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
        violet: {
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
        },
        rose: {
          300: "#fda4af",
          400: "#fb7185",
          500: "#f43f5e",
        },
        emerald: {
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
        },
        amber: {
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs:   ["11px", { lineHeight: "16px" }],
        sm:   ["12px", { lineHeight: "16px" }],
        base: ["13px", { lineHeight: "18px" }],
        md:   ["14px", { lineHeight: "20px" }],
        lg:   ["16px", { lineHeight: "22px" }],
        xl:   ["20px", { lineHeight: "26px" }],
        "2xl": ["24px", { lineHeight: "30px" }],
        "3xl": ["28px", { lineHeight: "34px" }],
      },
      fontFeatureSettings: { tabular: '"tnum", "lnum"' },
      boxShadow: {
        card:         "0 1px 0 0 rgba(255,255,255,.03) inset, 0 10px 28px -16px rgba(0,0,0,.65)",
        "card-lg":    "0 1px 0 0 rgba(255,255,255,.03) inset, 0 20px 60px -24px rgba(0,0,0,.85)",
        ring:         "0 0 0 1px rgba(34, 211, 238, .35), 0 0 22px -8px rgba(34, 211, 238, .35)",
        "ring-rose":  "0 0 0 1px rgba(244, 63, 94, .35), 0 0 22px -8px rgba(244, 63, 94, .35)",
        "ring-amber": "0 0 0 1px rgba(245, 158, 11, .35), 0 0 22px -8px rgba(245, 158, 11, .35)",
        "inset-line": "inset 0 -1px 0 0 rgba(255,255,255,.04)",
      },
      backdropBlur: { xs: "2px" },
      animation: {
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "fade-in":   "fade-in .2s ease-out",
        "slide-up":  "slide-up .25s ease-out",
        "slide-in":  "slide-in .25s ease-out",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: 1, transform: "scale(1)" },
          "50%":      { opacity: .45, transform: "scale(.85)" },
        },
        "fade-in":  { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } },
        "slide-in": { from: { opacity: 0, transform: "translateX(-6px)" }, to: { opacity: 1, transform: "translateX(0)" } },
      },
    },
  },
  plugins: [],
};
