/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./app.js"],
  // Theming (light/dark) is handled entirely via CSS custom properties that
  // flip based on the [data-theme] attribute on <html> — see src/input.css.
  // Tailwind's own dark: variant isn't used, so no darkMode config needed.
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        border: "var(--border)",
        ink: "var(--text)",
        "ink-dim": "var(--text-dim)",
        "ink-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-dim": "var(--accent-dim)",
        long: "var(--long)",
        short: "var(--short)",
        win: "var(--win)",
        "win-dim": "var(--win-dim)",
        loss: "var(--loss)",
        "loss-dim": "var(--loss-dim)",
        be: "var(--be)",
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        DEFAULT: "var(--shadow)",
      },
      maxWidth: {
        shell: "var(--shell-max)",
      },
      width: {
        nav: "var(--nav-w)",
      },
      keyframes: {
        pulse2: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.4 } },
        fadeUp: { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        kpiIn: { from: { opacity: 0, transform: "translateY(6px) scale(0.98)" }, to: { opacity: 1, transform: "none" } },
        cardIn: { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "none" } },
      },
      animation: {
        pulse2: "pulse2 2.4s ease-in-out infinite",
        fadeUp: "fadeUp .25s ease",
        kpiIn: "kpiIn .35s ease both",
        cardIn: "cardIn .3s ease both",
      },
    },
  },
  plugins: [],
};
