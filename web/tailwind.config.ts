import type { Config } from "tailwindcss";

// Every value points at a custom property in src/styles/tokens.css, so tokens stay in one file.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--page-bg)",
        surface: "var(--surface)",
        deep: "var(--surface-deep)",
        frame: "var(--frame)",
        line: { DEFAULT: "var(--line)", 2: "var(--line-2)" },
        ink: {
          DEFAULT: "var(--ink)",
          head: "var(--ink-head)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          4: "var(--ink-4)",
        },
        brand: { DEFAULT: "var(--brand)", hover: "var(--brand-hover)", pressed: "var(--brand-pressed)", deep: "var(--brand-deep)" },
        badge: "var(--color-surface-badge)",
        ok: "var(--color-surface-success)",
        warn: "var(--color-surface-warning)",
        regime: {
          deploy: "var(--regime-deploy)",
          plateau: "var(--regime-plateau)",
          lift: "var(--regime-lift)",
          brake: "var(--regime-brake)",
          other: "var(--regime-other)",
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        display: "var(--font-display)",
      },
      borderRadius: {
        xxs: "var(--radius-xxs)",
        xs: "var(--radius-xs)",
        s: "var(--radius-s)",
        m: "var(--radius-m)",
        l: "var(--radius-l)",
        xl: "var(--radius-xl)",
      },
      maxWidth: { container: "var(--container)" },
      spacing: { header: "var(--header-h)" },
    },
  },
  plugins: [],
} satisfies Config;
