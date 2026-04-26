import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        "ink-4": "var(--ink-4)",
        rule: "var(--rule)",
        "rule-soft": "var(--rule-soft)",
        indigo: "var(--indigo)",
        "indigo-soft": "var(--indigo-soft)",
        violet: "var(--violet)",
        "violet-soft": "var(--violet-soft)",
        magenta: "var(--magenta)",
        "magenta-soft": "var(--magenta-soft)",
        accent: "var(--indigo)",
        panel: "var(--surface-2)",
      },
      fontFamily: {
        serif: ["Instrument Serif", "Georgia", "serif"],
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        pill: "9999px",
      },
    },
  },
  plugins: [],
} satisfies Config;
